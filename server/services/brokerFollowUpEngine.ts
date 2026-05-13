/**
 * Broker Follow-Up Automation Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Fires automatically when an invoice transitions to `funded` (collections-ready).
 * Creates a `broker_follow_ups` record, writes to the event ledger and activity
 * feed, and attempts an optional SendGrid email to the debtor contact.
 */

import { db } from "../db";
import {
  brokerFollowUps,
  invoices,
  clients,
  debtors,
  brokers,
  eventLedger,
} from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import { storage } from "../storage";
import { sendEmail } from "../emailService";

// ─── Email body builder ───────────────────────────────────────────────────────

function buildEmailBody(
  invoiceNumber: string,
  amount: string,
  loadNumber: string | null | undefined,
  clientName: string,
): string {
  const lines = [
    "Dear Broker / Debtor,",
    "",
    `This is an automated payment follow-up from Trucking Pros Financial regarding`,
    `invoice ${invoiceNumber} for carrier ${clientName}.`,
    "",
    `  Load #:           ${loadNumber ?? "N/A"}`,
    `  Invoice Amount:   $${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    "",
    "The carrier advance has been processed and payment is now due.",
    "Please remit at your earliest convenience.",
    "",
    "If you have questions, contact our collections team directly.",
    "",
    "Thank you,",
    "Trucking Pros Financial — Collections Team",
  ];
  return lines.join("\n");
}

// ─── Core trigger function ────────────────────────────────────────────────────

/**
 * Creates a broker follow-up for the given invoice.
 * Idempotent for `auto` triggers — will not create a duplicate if one already
 * exists for the same invoice + triggerStatus combo.
 *
 * @returns the broker_follow_up id, or null if the invoice was not found
 */
export async function triggerBrokerFollowUp(
  invoiceId: number,
  actorId: string,
  triggerStatus = "funded",
  triggerType: "auto" | "manual" = "auto",
): Promise<number | null> {
  // 1. Load invoice
  const [inv] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!inv) return null;

  // 2. Idempotency guard for auto triggers
  if (triggerType === "auto") {
    const [existing] = await db
      .select({ id: brokerFollowUps.id })
      .from(brokerFollowUps)
      .where(
        and(
          eq(brokerFollowUps.invoiceId, invoiceId),
          eq(brokerFollowUps.triggerStatus, triggerStatus),
          eq(brokerFollowUps.triggerType, "auto"),
        ),
      )
      .limit(1);
    if (existing) return existing.id;
  }

  // 3. Fetch carrier/client name
  let clientName = "Carrier";
  if (inv.clientId) {
    const [cl] = await db
      .select({ name: clients.name })
      .from(clients)
      .where(eq(clients.id, inv.clientId));
    if (cl) clientName = cl.name;
  }

  const subject = `Payment Follow-Up — Invoice ${inv.invoiceNumber} [${clientName}]`;
  const body = buildEmailBody(
    inv.invoiceNumber,
    inv.amount,
    inv.loadNumber,
    clientName,
  );

  // 4. Insert broker_follow_up record
  const [record] = await db
    .insert(brokerFollowUps)
    .values({
      invoiceId,
      clientId: inv.clientId ?? null,
      brokerId: null,
      triggerType,
      triggerStatus,
      subject,
      body,
      status: "pending",
      sentBy: actorId,
    })
    .returning({ id: brokerFollowUps.id });

  // 5. Write to event_ledger — surfaces in invoice timeline + audit trail
  await db.insert(eventLedger).values({
    entityType: "invoice",
    entityId: invoiceId,
    eventType: "broker_followup_triggered",
    actorType: triggerType === "auto" ? "system" : "user",
    actorId,
    payloadJson: {
      followUpId: record.id,
      triggerStatus,
      triggerType,
      subject,
      clientName,
      invoiceNumber: inv.invoiceNumber,
    },
  });

  // 6. Write to activity feed
  try {
    await storage.createActivity({
      userId: actorId,
      type: "broker_followup_triggered",
      description: `Broker follow-up ${triggerType === "auto" ? "auto-triggered" : "manually triggered"} for invoice ${inv.invoiceNumber} — ${clientName}`,
      entityType: "invoice",
      entityId: invoiceId,
    } as any);
  } catch (_) {
    // activity feed is best-effort
  }

  // 7. Attempt email via SendGrid — best-effort, never blocks the flow
  try {
    let recipientEmail: string | null = null;

    // Try debtor email first (broker/debtor is who owes payment)
    if (inv.debtorId) {
      const [debtor] = await db
        .select({ email: debtors.email })
        .from(debtors)
        .where(eq(debtors.id, inv.debtorId));
      if (debtor?.email) recipientEmail = debtor.email;
    }

    if (recipientEmail) {
      await sendEmail({
        to: recipientEmail,
        subject,
        html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${body}</pre>`,
      });
      await db
        .update(brokerFollowUps)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(brokerFollowUps.id, record.id));
    }
  } catch (_) {
    // Email failure does not surface to caller
  }

  return record.id;
}
