import { randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { emailLog, emailLogEvents, emailRetryPayloads } from "../../shared/schema";
import type { EmailLogRecorder, ResendEmailParams } from "../resendTransport.js";
import { encryptVault, decryptVault } from "./vaultCrypto";
import { uploadToS3 } from "./s3Service";
import { currentEmailActor } from "./emailContext";
import { z } from "zod";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type EmailStore = typeof db | Tx;
type Status = typeof emailLog.$inferSelect.status;
export const statusRank: Record<Status, number> = { failed: 0, sent: 1, delivered: 2, bounced: 3, complained: 4 };
export class EmailLogError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export function emailPreview(params: Pick<ResendEmailParams, "html" | "text">): string {
  const text = params.text?.trim() || (params.html ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ");
  return text.replace(/&#x([a-f0-9]+);/gi, (_, value) => String.fromCodePoint(Math.min(parseInt(value, 16), 0x10ffff)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Math.min(Number(value), 0x10ffff)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, value: string) => ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[value]!)
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\/api\/broker-(confirm|dispute)\/[a-f0-9-]+/gi, "/api/broker-$1/[redacted]")
    .replace(/([?&](?:token|password|secret|code)=)[^\s&]+/gi, "$1[redacted]")
    .replace(/((?:password|verification code|one.time code|otp)\s*[:=]\s*)\S+/gi, "$1[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 200);
}
function encryptPayload(value: unknown) {
  if (!process.env.VAULT_SECRET && !process.env.SESSION_SECRET) throw new Error("Email retry encryption is not configured");
  return encryptVault(JSON.stringify(value));
}
export function decryptEmailPayload(value: string): ResendEmailParams & { originalFrom: string; originalReplyTo: string } {
  try { return JSON.parse(decryptVault(value)); }
  catch { throw new EmailLogError(409, "The encrypted retry payload cannot be read; resend from the linked entity instead."); }
}
const eventSchema = z.object({
  type: z.string().max(100),
  created_at: z.string().datetime({ offset: true }),
  data: z.object({ email_id: z.string().min(1).max(200),
    tags: z.object({ email_log_key: z.string().regex(/^[a-f0-9]{64}$/).optional() }).passthrough().optional(),
    bounce: z.object({ message: z.string().max(2000).optional() }).passthrough().optional() }).passthrough(),
}).passthrough();

export function createEmailLogRecorder({
  store = db, upload = uploadToS3, now = () => new Date(),
}: { store?: EmailStore; upload?: typeof uploadToS3; now?: () => Date } = {}): EmailLogRecorder {
  const event = (tx: Tx, id: number, type: string, status: Status | null, notes: string | null = null) =>
    tx.insert(emailLogEvents).values({ emailLogId: id, type, status, notes, occurredAt: now() });
  async function applyProviderEvents(tx: Tx, id: number, messageId: string) {
    const [row] = await tx.select().from(emailLog).where(eq(emailLog.id, id));
    const events = await tx.select().from(emailLogEvents).where(eq(emailLogEvents.resendMessageId, messageId));
    let nextStatus = row.status, updated = row.statusUpdatedAt, error = row.error;
    for (const entry of events) {
      if (entry.status && (statusRank[entry.status] > statusRank[nextStatus] ||
        (entry.status === nextStatus && entry.occurredAt > updated))) {
        nextStatus = entry.status; updated = entry.occurredAt;
        error = ["bounced", "complained", "failed"].includes(nextStatus) ? entry.notes : null;
      }
    }
    await tx.update(emailLog).set({ status: nextStatus, statusUpdatedAt: updated, error }).where(eq(emailLog.id, id));
  }
  return {
    async previousAcceptance(key, correlationKey) {
      const accepted = await store.select({ messageId: emailLog.resendMessageId, correlationKey: emailRetryPayloads.correlationKey })
        .from(emailRetryPayloads).innerJoin(emailLog, eq(emailLog.id, emailRetryPayloads.emailLogId))
        .where(and(eq(emailRetryPayloads.idempotencyKey, key), sql`${emailLog.resendMessageId} IS NOT NULL`,
          sql`${emailLog.status} <> 'failed'`));
      if (accepted.some(row => row.correlationKey && row.correlationKey !== correlationKey)) {
        throw new EmailLogError(409, "This delivery key already accepted a different message. Start a new email from the linked entity.");
      }
      return accepted.find(row => row.correlationKey === correlationKey)?.messageId ?? null;
    },
    async begin(params, body, key) {
      const at = now();
      const meta = params.emailLog;
      const actor = meta?.sentByUserId === undefined ? currentEmailActor() : meta.sentByUserId;
      const encryptedPayload = encryptPayload({ ...params, idempotencyKey: key, originalFrom: body.from, originalReplyTo: body.reply_to });
      const id = await store.transaction(async tx => {
        const [row] = await tx.insert(emailLog).values({
          fromAddress: String(body.from).match(/<([^>]+)>/)?.[1] ?? String(body.from),
          toAddresses: body.to, ccAddresses: body.cc ?? [], subject: params.subject,
          bodyPreview: emailPreview(params), templateName: meta?.templateName ?? null,
          entityType: meta?.entityType ?? null, entityId: meta?.entityId == null ? null : String(meta.entityId),
          sentByUserId: actor,
          status: "failed", error: "Delivery is in progress; provider acceptance is not yet confirmed.",
          createdAt: at, statusUpdatedAt: at,
          attachments: (params.attachments ?? []).map(a => ({ filename: a.filename, s3_key: a.s3Key ?? null, size: Buffer.from(a.content, "base64").length })),
        }).returning({ id: emailLog.id });
        await tx.insert(emailRetryPayloads).values({ emailLogId: row.id, encryptedPayload, idempotencyKey: key,
          correlationKey: body.tags[0].value,
          deliveryContext: meta ? { ...meta, sentByUserId: actor } : null,
          state: "sending", uncertain: true, lockUntil: new Date(at.getTime() + 120_000), retryOfId: meta?.retryOfId });
        await event(tx, row.id, "sending", null);
        return row.id;
      });
      try {
        const attachments = (params.attachments ?? []).map(a => ({
          filename: a.filename, s3_key: a.s3Key ?? null, size: Buffer.from(a.content, "base64").length,
        }));
        for (const [index, attachment] of (params.attachments ?? []).entries()) {
          const buffer = Buffer.from(attachment.content, "base64");
          const filename = attachment.filename.replace(/[\r\n"\\/]/g, "_");
          const key = attachment.s3Key ?? `email-log/${id}/${randomUUID()}-${filename}`;
          if (!attachment.s3Key) await upload(buffer, key, attachment.type ?? "application/octet-stream");
          attachments[index] = { filename: attachment.filename, s3_key: key, size: buffer.length };
          // Preserve each successfully stored object even if a later attachment
          // fails, so failed-message history does not leave untracked files.
          await store.update(emailLog).set({ attachments: [...attachments] }).where(eq(emailLog.id, id));
        }
        return id;
      } catch {
        await this.failed(id, { message: "Email attachment storage failed; no provider send was attempted.", uncertain: false });
        throw new EmailLogError(503, "Email attachment storage failed; the failed attempt was logged.");
      }
    },
    async originalPayload(key) {
      const [row] = await store.select({ encryptedPayload: emailRetryPayloads.encryptedPayload })
        .from(emailRetryPayloads).where(eq(emailRetryPayloads.idempotencyKey, key)).limit(1);
      return row?.encryptedPayload ? decryptEmailPayload(row.encryptedPayload) : undefined;
    },
    async accepted(id, messageId) {
      await store.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'email-log/' + messageId}, 0))`);
        await tx.execute(sql`SELECT id FROM email_log WHERE id = ${id} FOR UPDATE`);
        const [row] = await tx.select().from(emailLog).where(eq(emailLog.id, id));
        const [retry] = await tx.select().from(emailRetryPayloads).where(eq(emailRetryPayloads.emailLogId, id));
        await tx.update(emailLog).set({
          resendMessageId: messageId, ...(statusRank[row.status] < statusRank.sent ? { status: "sent" as const, statusUpdatedAt: now(), error: null } : {}),
        }).where(eq(emailLog.id, id));
        await tx.update(emailRetryPayloads).set({ state: "accepted", encryptedPayload: null, uncertain: false, lockUntil: null }).where(eq(emailRetryPayloads.emailLogId, id));
        await event(tx, id, "sent", "sent", "Resend accepted the message; delivery is not yet confirmed.");
        await applyProviderEvents(tx, id, messageId);
        if (retry?.retryOfId) {
          await tx.update(emailRetryPayloads).set({ state: "accepted", encryptedPayload: null, lockUntil: null, resolvedById: id })
            .where(and(or(eq(emailRetryPayloads.emailLogId, retry.retryOfId), eq(emailRetryPayloads.retryOfId, retry.retryOfId)), sql`${emailRetryPayloads.emailLogId} <> ${id}`));
          await event(tx, retry.retryOfId, "resent", null, `Retried as email log #${id}.`);
        }
      });
    },
    async failed(id, error) {
      await store.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM email_log WHERE id = ${id} FOR UPDATE`);
        const [row] = await tx.select().from(emailLog).where(eq(emailLog.id, id));
        const [retry] = await tx.select().from(emailRetryPayloads).where(eq(emailRetryPayloads.emailLogId, id));
        // A verified delivery event must never be overwritten by a late local error.
        if (row.status === "failed") await tx.update(emailLog).set({ statusUpdatedAt: now(), error: error.message.slice(0, 2000) }).where(eq(emailLog.id, id));
        if (row.status === "failed") await tx.update(emailRetryPayloads).set({ state: "failed", uncertain: error.uncertain, lockUntil: null }).where(eq(emailRetryPayloads.emailLogId, id));
        if (row.status === "failed" && retry?.retryOfId) await tx.update(emailRetryPayloads).set({
          state: "failed", uncertain: sql`${emailRetryPayloads.uncertain} OR ${error.uncertain}`, lockUntil: null,
        }).where(eq(emailRetryPayloads.emailLogId, retry.retryOfId));
        await event(tx, id, "failed", "failed", error.message.slice(0, 2000));
      });
    },
  };
}
export const emailLogRecorder = createEmailLogRecorder();

export async function processResendEvent(providerEventId: string, payload: unknown, store: EmailStore = db) {
  const value = eventSchema.parse(payload);
  const status = ({ "email.sent": "sent", "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained" } as Record<string, Status>)[value.type];
  if (!status) return { ignored: true };
  const at = new Date(value.created_at);
  const notes = status === "bounced" ? value.data.bounce?.message ?? "Resend reported a bounce." :
    status === "complained" ? "Recipient reported this email as spam." : null;
  return store.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'email-log/' + value.data.email_id}, 0))`);
    const [inserted] = await tx.insert(emailLogEvents).values({ providerEventId, resendMessageId: value.data.email_id,
      type: value.type, status, notes, occurredAt: at }).onConflictDoNothing().returning({ id: emailLogEvents.id });
    if (!inserted) return { duplicate: true };
    const where = or(eq(emailLog.resendMessageId, value.data.email_id), value.data.tags?.email_log_key ?
      and(sql`${emailLog.id} IN (SELECT email_log_id FROM email_retry_payloads WHERE correlation_key = ${value.data.tags.email_log_key})`,
        or(sql`${emailLog.resendMessageId} IS NULL`, eq(emailLog.resendMessageId, value.data.email_id))) : undefined);
    const rows = await tx.select().from(emailLog).where(where).for("update");
    for (const row of rows) if (statusRank[status] > statusRank[row.status] || (status === row.status && at > row.statusUpdatedAt)) {
      await tx.update(emailLog).set({ resendMessageId: value.data.email_id, status, statusUpdatedAt: at, error: notes }).where(eq(emailLog.id, row.id));
      // Verified receipt settles an otherwise uncertain delivery, without the
      // original HTTP acceptance response being necessary.
      await tx.update(emailRetryPayloads).set({ state: "accepted", uncertain: false, lockUntil: null, encryptedPayload: null })
        .where(eq(emailRetryPayloads.emailLogId, row.id));
    }
    return { received: true };
  });
}

export async function claimEmailRetry(id: number, store: EmailStore = db) {
  return store.transaction(async tx => {
    const [requestedLog] = await tx.select().from(emailLog).where(eq(emailLog.id, id));
    if (!requestedLog) throw new EmailLogError(404, "Email not found");
    if (requestedLog.status !== "failed") throw new EmailLogError(409, "Only failed emails can be retried.");
    let rootId = id;
    const seen = new Set<number>();
    for (;;) {
      if (seen.has(rootId)) throw new EmailLogError(409, "Invalid email retry chain");
      seen.add(rootId);
      const [parent] = await tx.select({ id: emailRetryPayloads.retryOfId }).from(emailRetryPayloads).where(eq(emailRetryPayloads.emailLogId, rootId));
      if (!parent?.id) break;
      rootId = parent.id;
    }
    await tx.execute(sql`SELECT email_log_id FROM email_retry_payloads WHERE email_log_id = ${rootId} FOR UPDATE`);
    const [log] = await tx.select().from(emailLog).where(eq(emailLog.id, rootId));
    const [retry] = await tx.select().from(emailRetryPayloads).where(eq(emailRetryPayloads.emailLogId, rootId));
    if (!log) throw new EmailLogError(404, "Email not found");
    const reason = retryDisabledReason(log.status, retry);
    if (reason) throw new EmailLogError(409, reason);
    await tx.update(emailRetryPayloads).set({ state: "sending", lockUntil: new Date(Date.now() + 120_000) }).where(eq(emailRetryPayloads.emailLogId, rootId));
    return { rootId, retry, params: decryptEmailPayload(retry!.encryptedPayload!) };
  });
}
export function retryDisabledReason(status: Status, retry?: Pick<typeof emailRetryPayloads.$inferSelect,
  "resolvedById" | "encryptedPayload" | "state" | "lockUntil" | "uncertain" | "createdAt">): string | null {
  if (status !== "failed") return "Only failed emails can be retried.";
  if (retry?.resolvedById) return `Already resent successfully as email #${retry.resolvedById}.`;
  if (!retry?.encryptedPayload) return "Original retry payload is unavailable; send from the linked entity.";
  if (retry.state === "sending" && retry.lockUntil && retry.lockUntil > new Date()) return "This email is still being sent.";
  if (retry.state === "accepted") return "Resend already accepted this email.";
  if ((retry.uncertain || retry.state === "sending") && Date.now() - retry.createdAt.getTime() > 23 * 3600_000) return "Delivery is uncertain and the safe retry window has expired; verify the original delivery first.";
  return null;
}
