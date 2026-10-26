import { and, asc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  brokerConfirmationSettings, brokers, clients, emailLog, eventLedger, invoiceChargebackWarnings,
  invoices, notifications, paymentApplicationLines, tasks,
} from "../../shared/schema";
import { ResendDeliveryError, sendResendEmail } from "../resendTransport.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Store = typeof db | Tx;
const DAY = 86_400_000;
const TEMPLATE = "chargeback_warning";
// Write-offs settle AR without being cash; partial payments reduce amount due.
const outstanding = sql<string>`greatest(0, ${invoices.amount} - coalesce((
  select sum(${paymentApplicationLines.appliedAmount} +
    case when ${paymentApplicationLines.varianceType} = 'write_off'
      then abs(coalesce(${paymentApplicationLines.variance}, 0)) else 0 end)
  from ${paymentApplicationLines} where ${paymentApplicationLines.invoiceId} = ${invoices.id}), 0))`;

async function currentInvoice(store: Store, id: number) {
  const [row] = await store.select({
    invoice: invoices, amountDue: outstanding, brokerEmail: brokers.email,
    processorId: clients.assignedProcessor,
  }).from(invoices).leftJoin(brokers, eq(brokers.id, invoices.brokerId))
    .leftJoin(clients, eq(clients.id, invoices.clientId)).where(eq(invoices.id, id));
  return row;
}

export function warningEligible(invoice: { fundedAt: Date | null; status: string; chargebackStatus: string },
  amountDue: string | number, threshold: number, now: Date) {
  return !!invoice.fundedAt && ["funded", "held"].includes(invoice.status) &&
    invoice.chargebackStatus !== "charged" && Number(amountDue) > 0 &&
    now.getTime() >= invoice.fundedAt.getTime() + threshold * DAY;
}

export function warningMessage(invoiceNumber: string, loadNumber: string | null, days: number, amount: string) {
  const formatted = Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `This is a reminder that Invoice ${invoiceNumber} for Load ${loadNumber || "not provided"} is now ${days} days past due. Per our agreement, invoices unpaid after 90 days are subject to chargeback. Amount due: ${formatted}. Please remit payment immediately.`;
}

/** Also used by signed provider events and manager retries after lost responses. */
export async function recordChargebackWarningSent(invoiceId: number, messageId: string, store: Store = db, at = new Date()) {
  await store.transaction(async tx => {
    const [warning] = await tx.select().from(invoiceChargebackWarnings)
      .where(eq(invoiceChargebackWarnings.invoiceId, invoiceId)).for("update");
    if (!warning || warning.status === "sent") return;
    await tx.update(invoiceChargebackWarnings).set({ status: "sent", messageId, sentAt: at, error: null })
      .where(eq(invoiceChargebackWarnings.invoiceId, invoiceId));
    await tx.insert(eventLedger).values({
      entityType: "invoice", entityId: invoiceId, eventType: "chargeback_warning_sent", actorType: "system", actorId: "system",
      payloadJson: { label: `${warning.thresholdDays}-day chargeback warning sent`, messageId,
        thresholdDays: warning.thresholdDays, agedDays: warning.agedDays, amountDue: warning.amountDue, taskId: warning.taskId },
      createdAt: at,
    });
  });
}

export async function validateChargebackWarningRetry(invoiceId: number, store: Store = db) {
  if (process.env.NODE_ENV !== "production") throw new Error("Live chargeback warning emails are blocked in Preview.");
  const row = await currentInvoice(store, invoiceId);
  const [warning] = await store.select().from(invoiceChargebackWarnings).where(eq(invoiceChargebackWarnings.invoiceId, invoiceId));
  if (!row || !warning || warning.status === "sent" || !warningEligible(row.invoice, row.amountDue, warning.thresholdDays, new Date())) {
    throw new Error("This invoice is paid, charged back, already warned, or no longer eligible.");
  }
  // A partial payment since the failed attempt makes the old amount misleading.
  if (Number(row.amountDue) !== Number(warning.amountDue)) throw new Error("The amount due has changed. Do not resend the outdated warning.");
}

export async function processChargebackWarnings({
  store = db, send = sendResendEmail, now = () => new Date(), invoiceIds,
}: { store?: Store; send?: typeof sendResendEmail; now?: () => Date; invoiceIds?: number[] } = {}) {
  const result = { sent: 0, failed: 0, skipped: 0, blockedInPreview: false };
  if (invoiceIds && !invoiceIds.length) return result;
  if (send === sendResendEmail && process.env.NODE_ENV !== "production") {
    result.blockedInPreview = true;
    return result;
  }
  const [settings] = await store.select().from(brokerConfirmationSettings).where(eq(brokerConfirmationSettings.id, 1));
  const threshold = z.number().int().min(1).max(89).parse(settings?.chargebackWarningDays ?? 80);
  const at = now();
  // Recover accepted sends even if the process died before the timeline commit.
  const accepted = await store.select({ invoiceId: invoiceChargebackWarnings.invoiceId, messageId: emailLog.resendMessageId })
    .from(invoiceChargebackWarnings).innerJoin(emailLog, and(
      eq(emailLog.entityType, "invoice"), eq(emailLog.templateName, TEMPLATE),
      sql`${emailLog.entityId} = ${invoiceChargebackWarnings.invoiceId}::text`, isNotNull(emailLog.resendMessageId),
    )).where(and(notInArray(invoiceChargebackWarnings.status, ["sent"]),
      invoiceIds ? inArray(invoiceChargebackWarnings.invoiceId, invoiceIds) : undefined));
  for (const row of accepted) await recordChargebackWarningSent(row.invoiceId, row.messageId!, store, at);

  const candidates = await store.select({ id: invoices.id }).from(invoices)
    .leftJoin(invoiceChargebackWarnings, eq(invoiceChargebackWarnings.invoiceId, invoices.id))
    .where(and(isNull(invoiceChargebackWarnings.invoiceId), isNotNull(invoices.fundedAt),
      invoiceIds ? inArray(invoices.id, invoiceIds) : undefined,
      sql`${invoices.fundedAt} <= ${new Date(at.getTime() - threshold * DAY)}`,
      inArray(invoices.status, ["funded", "held"]), notInArray(invoices.chargebackStatus, ["charged"]),
      sql`${outstanding} > 0`)).orderBy(asc(invoices.fundedAt), asc(invoices.id));

  for (const candidate of candidates) {
    // Commit the claim BEFORE making an external request. A crash cannot cause
    // a later scheduler run to mint a new key/send another warning.
    const claimed = await store.transaction(async tx => {
      const lock = await tx.execute(sql`select id from ${invoices} where id = ${candidate.id} for update skip locked`);
      if (!lock.rows.length) return null;
      const row = await currentInvoice(tx, candidate.id);
      if (!row || !warningEligible(row.invoice, row.amountDue, threshold, at)) return null;
      const invoice = row.invoice;
      const days = Math.floor((at.getTime() - invoice.fundedAt!.getTime()) / DAY);
      const body = warningMessage(invoice.invoiceNumber, invoice.loadNumber, days, row.amountDue);
      const [warning] = await tx.insert(invoiceChargebackWarnings).values({
        invoiceId: invoice.id, thresholdDays: threshold, agedDays: days, amountDue: row.amountDue,
        recipient: row.brokerEmail?.trim() || null, subject: `${threshold}-day chargeback warning — Invoice ${invoice.invoiceNumber}`,
        body, status: "sending", createdAt: at,
      }).onConflictDoNothing().returning();
      if (!warning) return null;
      const assignedTo = invoice.assignedTo ?? invoice.assignedFollowupAgentId ?? row.processorId;
      const [task] = await tx.insert(tasks).values({
        title: `${threshold}-day chargeback follow-up — ${invoice.invoiceNumber}`,
        description: `${body}\n\nInvoice: /invoices/${invoice.id}`,
        type: "followup", priority: "high", status: "todo", assignedTo, clientId: invoice.clientId, dueDate: at,
      }).returning({ id: tasks.id });
      await tx.update(invoiceChargebackWarnings).set({ taskId: task.id }).where(eq(invoiceChargebackWarnings.invoiceId, invoice.id));
      if (assignedTo) await tx.insert(notifications).values({
        userId: assignedTo, title: "Chargeback warning follow-up", message: `Follow up on invoice ${invoice.invoiceNumber} before chargeback.`,
        type: "warning", entityType: "invoice", entityId: invoice.id, actionUrl: `/invoices/${invoice.id}`,
      });
      return { ...warning, taskId: task.id };
    });
    if (!claimed) { result.skipped++; continue; }
    try {
      const sent = await store.transaction(async tx => {
        // Block payment/chargeback transitions until acceptance; re-check after
        // claiming so a concurrent payment cannot turn into an overdue email.
        await tx.execute(sql`select id from ${invoices} where id = ${candidate.id} for update`);
        const row = await currentInvoice(tx, candidate.id);
        if (!row || !warningEligible(row.invoice, row.amountDue, threshold, now())) {
          await tx.update(invoiceChargebackWarnings).set({ status: "skipped", error: "Invoice balance or eligibility changed before sending." })
            .where(eq(invoiceChargebackWarnings.invoiceId, candidate.id));
          return false;
        }
        // No provider call has happened yet: refresh the initial snapshot if
        // a partial payment/contact edit arrived between claim and delivery.
        const days = Math.floor((now().getTime() - row.invoice.fundedAt!.getTime()) / DAY);
        const body = warningMessage(row.invoice.invoiceNumber, row.invoice.loadNumber, days, row.amountDue);
        const recipient = row.brokerEmail?.trim() || null;
        await tx.update(invoiceChargebackWarnings).set({ amountDue: row.amountDue, body, recipient, agedDays: days })
          .where(eq(invoiceChargebackWarnings.invoiceId, candidate.id));
        await tx.update(tasks).set({ description: `${body}\n\nInvoice: /invoices/${candidate.id}` }).where(eq(tasks.id, claimed.taskId));
        if (!z.string().email().safeParse(recipient).success) throw new ResendDeliveryError(400, "Broker has no valid email address.", false);
        let messageId: string;
        try {
          messageId = await send({
            to: recipient!, subject: claimed.subject, text: body,
            idempotencyKey: `chargeback-warning/${candidate.id}`,
            emailLog: { templateName: TEMPLATE, entityType: "invoice", entityId: candidate.id, sentByUserId: null },
          });
        } catch (error) {
          // A provider rejection is not a transaction failure: preserve the
          // transport's attempt log even for transaction-scoped adapters.
          return { error };
        }
        await recordChargebackWarningSent(candidate.id, messageId, tx, now());
        return true;
      });
      if (typeof sent === "object") throw sent.error;
      if (sent) result.sent++; else result.skipped++;
    } catch (error) {
      const uncertain = !(error instanceof ResendDeliveryError) || error.uncertain;
      const message = error instanceof Error ? error.message : "Chargeback warning failed.";
      await store.transaction(async tx => {
        const changed = await tx.update(invoiceChargebackWarnings).set({ status: uncertain ? "uncertain" : "failed", error: message })
          .where(and(eq(invoiceChargebackWarnings.invoiceId, candidate.id), eq(invoiceChargebackWarnings.status, "sending"))).returning();
        if (changed.length) await tx.insert(eventLedger).values({
          entityType: "invoice", entityId: candidate.id, eventType: "chargeback_warning_failed", actorType: "system", actorId: "system",
          payloadJson: { label: "Chargeback warning delivery failed", error: message, uncertain },
        });
      });
      result.failed++;
      console.warn(`[agingScheduler] chargeback warning failed for invoice ${candidate.id}: ${message}`);
    }
    if (send === sendResendEmail) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return result;
}
