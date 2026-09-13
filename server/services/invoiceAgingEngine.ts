import { and, asc, eq, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { brokers, clients, debtors, eventLedger, invoiceAgingAlerts, invoices, invoiceStatusHistory, notifications, users } from "@shared/schema";

const DAY_MS = 86_400_000;

/**
 * Creates aging alerts and their internal notifications. The database unique
 * key makes repeated scheduler runs safe, including concurrent application
 * instances.
 */
export async function processInvoiceAgingAlerts(): Promise<{ created: number }> {
  const now = new Date();
  let created = 0;

  // Existing funded invoices predate the dedicated fundedAt column. Recover
  // their original funding date from lifecycle history so they can age normally.
  const missingFundingDates = await db.select({
    id: invoices.id,
    fallbackDate: invoices.updatedAt,
  }).from(invoices).where(and(
    isNull(invoices.fundedAt),
    inArray(invoices.status, ["funded", "settled", "paid"] as any[]),
  ));
  for (const invoice of missingFundingDates) {
    const [fundingEvent] = await db.select({ createdAt: invoiceStatusHistory.createdAt })
      .from(invoiceStatusHistory)
      .where(and(
        eq(invoiceStatusHistory.invoiceId, invoice.id),
        eq(invoiceStatusHistory.newStatus, "funded"),
      ))
      .orderBy(asc(invoiceStatusHistory.createdAt))
      .limit(1);
    const fundedAt = fundingEvent?.createdAt ?? invoice.fallbackDate;
    if (fundedAt) {
      await db.update(invoices).set({ fundedAt }).where(and(
        eq(invoices.id, invoice.id),
        isNull(invoices.fundedAt),
      ));
    }
  }

  const funded = await db.select({
    id: invoices.id, invoiceNumber: invoices.invoiceNumber, fundedAt: invoices.fundedAt,
    clientName: clients.name,
    brokerName: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`,
    chargebackStatus: invoices.chargebackStatus, chargebackDate: invoices.chargebackDate,
  }).from(invoices)
    .leftJoin(clients, eq(invoices.clientId, clients.id))
    .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
    .leftJoin(debtors, eq(invoices.debtorId, debtors.id))
    .where(and(isNotNull(invoices.fundedAt), notInArray(invoices.status, ["paid", "settled", "collected"] as any[])));
  const recipients = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.status, "active"), inArray(users.role, ["employee", "manager", "admin"])));

  for (const invoice of funded) {
    const days = Math.floor((now.getTime() - invoice.fundedAt!.getTime()) / DAY_MS);
    const types = days >= 90 ? ["day_60", "day_90"] as const : days >= 60 ? ["day_60"] as const : [];
    for (const alertType of types) {
      const inserted = await db.insert(invoiceAgingAlerts).values({
        invoiceId: invoice.id, alertType, status: "pending",
      }).onConflictDoNothing().returning({ id: invoiceAgingAlerts.id });
      const [alert] = inserted[0]
        ? inserted
        : await db.select({ id: invoiceAgingAlerts.id }).from(invoiceAgingAlerts)
          .where(and(eq(invoiceAgingAlerts.invoiceId, invoice.id), eq(invoiceAgingAlerts.alertType, alertType)))
          .limit(1);
      if (!alert) continue;
      if (inserted[0]) created++;
      const urgent = alertType === "day_90";
      const carrier = invoice.clientName ?? "Carrier";
      const broker = invoice.brokerName ?? "Broker";
      const title = urgent ? "90 Day Past Due Invoice" : "60 Day Invoice Alert";
      const message = urgent
        ? `Invoice ${invoice.invoiceNumber} for ${carrier} is 90 days old — PAST DUE. Broker ${broker} must remit payment immediately`
        : `Invoice ${invoice.invoiceNumber} for ${carrier} is 60 days old — follow up with ${broker} immediately`;
      for (const user of recipients) {
        const [existing] = await db.select({ id: notifications.id }).from(notifications).where(and(
          eq(notifications.userId, user.id),
          eq(notifications.entityType, "invoice"),
          eq(notifications.entityId, invoice.id),
          eq(notifications.title, title),
        )).limit(1);
        if (!existing) {
          await storage.createNotification({
            userId: user.id, title,
            message, type: urgent ? "error" : "warning", entityType: "invoice", entityId: invoice.id,
            actionUrl: `/invoices/${invoice.id}`,
            metadata: JSON.stringify({ category: "invoice_aging", severity: urgent ? "red" : "amber", alertType, days, agingAlertId: alert.id }),
          } as any);
        }
      }
      if (inserted[0]) {
        await db.insert(eventLedger).values({
          entityType: "invoice", entityId: invoice.id, eventType: "invoice_aging_alert_triggered",
          actorType: "system", actorId: "system", payloadJson: { alertType, days, alertId: alert.id },
        });
      }
    }

    const carrier = invoice.clientName ?? "Carrier";
    const broker = invoice.brokerName ?? "Broker";
    const extensionStillActive = invoice.chargebackStatus === "extended" && invoice.chargebackDate && invoice.chargebackDate > now;
    if (days >= 90 && !extensionStillActive) {
      const [changed] = await db.update(invoices).set({
        chargebackStatus: "charged", chargebackDate: invoice.fundedAt
          ? new Date(invoice.fundedAt.getTime() + 90 * DAY_MS) : now, updatedAt: now,
      }).where(and(eq(invoices.id, invoice.id), notInArray(invoices.chargebackStatus, ["charged"] as any[]), or(
        notInArray(invoices.chargebackStatus, ["extended"] as any[]),
        lte(invoices.chargebackDate, now),
      ))).returning({ id: invoices.id });
      if (changed) {
        for (const user of recipients) await storage.createNotification({
          userId: user.id, title: "Chargeback Applied",
          message: `Invoice ${invoice.invoiceNumber} for ${carrier} has been charged back — 90 days with no payment from ${broker}`,
          type: "error", entityType: "invoice", entityId: invoice.id, actionUrl: `/invoices/${invoice.id}`,
          metadata: JSON.stringify({ category: "chargeback", severity: "red", status: "charged" }),
        } as any);
        await db.insert(eventLedger).values({ entityType: "invoice", entityId: invoice.id, eventType: "chargeback_applied", actorType: "system", actorId: "system", payloadJson: { days, broker } });
      }
    } else if (days >= 60) {
      const chargebackDate = new Date(invoice.fundedAt!.getTime() + 60 * DAY_MS);
      const [changed] = await db.update(invoices).set({
        chargebackStatus: "scheduled", chargebackDate, updatedAt: now,
      }).where(and(eq(invoices.id, invoice.id), eq(invoices.chargebackStatus, "none"))).returning({ id: invoices.id });
      if (changed) {
        for (const user of recipients) await storage.createNotification({
          userId: user.id, title: "Scheduled for Chargeback",
          message: `Invoice ${invoice.invoiceNumber} for ${carrier} has been scheduled for chargeback — 60 days with no payment from ${broker}`,
          type: "warning", entityType: "invoice", entityId: invoice.id, actionUrl: `/invoices/${invoice.id}`,
          metadata: JSON.stringify({ category: "chargeback", severity: "amber", status: "scheduled" }),
        } as any);
        await db.insert(eventLedger).values({ entityType: "invoice", entityId: invoice.id, eventType: "chargeback_scheduled", actorType: "system", actorId: "system", payloadJson: { days, chargebackDate, broker } });
      }
    }
  }
  return { created };
}

let scheduler: NodeJS.Timeout | null = null;
export function startInvoiceAgingScheduler(intervalMs = DAY_MS): void {
  if (scheduler) return;
  processInvoiceAgingAlerts().catch(e => console.warn("[agingScheduler] initial run error:", e?.message));
  scheduler = setInterval(() => processInvoiceAgingAlerts().catch(e =>
    console.warn("[agingScheduler] run error:", e?.message)), intervalMs);
}