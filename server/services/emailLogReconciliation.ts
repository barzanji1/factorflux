import { and, eq, inArray } from "drizzle-orm";
import { brokerFollowUps, brokerFollowUpReminders, clientEmailLogs, invoices, emailLog, emailRetryPayloads } from "../../shared/schema";
import { db } from "../db";
import type { ResendEmailParams } from "../resendTransport.js";
import { createBrokerConfirmationService } from "./brokerConfirmationService";
import { EmailLogError, type EmailStore } from "./emailLogService";

export async function validateEmailRetryDomain(params: ResendEmailParams, store: EmailStore = db) {
  const meta = params.emailLog;
  if (meta?.templateName?.startsWith("broker_collections_")) {
    throw new EmailLogError(409, "Retry this email by resuming its VP / RPS workflow. Email Log cannot bypass automation pause, stop, paid, or global controls.");
  }
  if (meta?.templateName === "broker_confirmation" && meta.entityId) {
    if (process.env.NODE_ENV !== "production") throw new EmailLogError(409, "Broker confirmation retries are disabled in Preview; publish first so confirmation links work.");
    const [invoice] = await store.select().from(invoices).where(eq(invoices.id, Number(meta.entityId)));
    if (!invoice || ["confirmed", "disputed", "resolved"].includes(invoice.brokerConfirmationStatus)) {
      throw new EmailLogError(409, "This invoice no longer needs broker confirmation.");
    }
    if (meta.confirmationReminder && invoice.confirmationRemindedCount >= meta.confirmationReminder) {
      throw new EmailLogError(409, "This reminder was already accepted through the invoice workflow.");
    }
  }
  if (meta?.followupReminderId) {
    const [reminder] = await store.select().from(brokerFollowUpReminders).where(eq(brokerFollowUpReminders.id, meta.followupReminderId));
    if (reminder?.status === "sent") throw new EmailLogError(409, "This follow-up was already sent through its workflow.");
  }
}
export async function reconcileEmailRetry(params: ResendEmailParams, messageId: string, actorId: string | null, store: EmailStore = db, acceptedAt?: Date) {
  const meta = params.emailLog, at = new Date();
  if (meta?.templateName === "client_email" && params.idempotencyKey?.startsWith("client-email/")) {
    await store.update(clientEmailLogs).set({ status: "sent", sentAt: at, updatedAt: at, errorMessage: null, providerMessageId: messageId })
      .where(eq(clientEmailLogs.requestId, params.idempotencyKey.slice("client-email/".length)));
  }
  if (meta?.templateName === "broker_confirmation" && meta.entityId) {
    await createBrokerConfirmationService({ store, ...(acceptedAt ? { now: () => acceptedAt } : {}) }).recordEmailRetry(Number(meta.entityId),
      { kind: actorId ? "agent" : "system", id: actorId ?? "resend-webhook" }, messageId, meta.confirmationReminder ?? null);
  }
  if (meta?.templateName === "broker_followup" && meta.entityId) {
    const followupId = Number(meta.entityId);
    await store.transaction(async tx => {
      const where = meta.followupReminderId ? eq(brokerFollowUpReminders.id, meta.followupReminderId) :
        and(eq(brokerFollowUpReminders.followUpId, followupId), eq(brokerFollowUpReminders.reminderType, "immediate"));
      await tx.update(brokerFollowUpReminders).set({
        status: "sent", actualSendAt: at, providerMessageId: messageId, deliveryStatus: "pending",
      }).where(and(where, inArray(brokerFollowUpReminders.status, ["scheduled", "sending"])));
      await tx.update(brokerFollowUps).set({ status: "sent", sentAt: at, updatedAt: at })
        .where(and(eq(brokerFollowUps.id, followupId), inArray(brokerFollowUps.status, ["pending", "failed"])));
    });
  }
}

// Run after the webhook transaction commits: the original sender may still
// hold the invoice lock while waiting for its provider acceptance response.
// Retained private metadata permits durable retries without retaining HTML.
export async function reconcileResendMessage(messageId: string, store: EmailStore = db) {
  const rows = await store.select({ context: emailRetryPayloads.deliveryContext, key: emailRetryPayloads.idempotencyKey,
    createdAt: emailLog.createdAt }).from(emailRetryPayloads).innerJoin(emailLog, eq(emailLog.id, emailRetryPayloads.emailLogId))
    .where(eq(emailLog.resendMessageId, messageId)).orderBy(emailLog.id);
  for (const row of rows) if (row.context?.templateName) {
    const context = row.context as NonNullable<ResendEmailParams["emailLog"]>;
    await reconcileEmailRetry({ to: [], subject: "", idempotencyKey: row.key, emailLog: context }, messageId,
      context.sentByUserId ?? null, store, row.createdAt);
  }
}
