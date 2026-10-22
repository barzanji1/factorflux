import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { clients, emailBroadcasts, emailBroadcastRecipients, emailBroadcastDispatch, users } from "@shared/schema";
import { broadcastDraftSchema, broadcastFiltersSchema, type BroadcastCounts, type BroadcastDetail, type BroadcastFilters, type BroadcastSummary } from "@shared/email-broadcast";
import { sendResendEmail, ResendDeliveryError, type ResendEmailParams } from "../resendTransport.js";
import { personalizeEmail, emailTemplateInputSchema } from "../../shared/email-templates";

type Database = Pick<typeof db, "select" | "selectDistinct" | "insert" | "update" | "transaction" | "execute">;
type Job = typeof emailBroadcasts.$inferSelect;
type Recipient = typeof emailBroadcastRecipients.$inferSelect;
const validEmail = z.string().trim().email().max(254);
export const BROADCAST_GAP_MS = 2000;
const MAX_DRAFT_AGE_MS = 30 * 60 * 1000;
const MAX_SEND_AGE_MS = 23 * 60 * 60 * 1000;
const WORKER_LOCK = 82651073;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const recipientDigest = (rows: { id: number; email: string | null }[]) =>
  digest(rows.map(row => [row.id, row.email?.trim().toLowerCase() ?? null]).sort((a, b) => Number(a[0]) - Number(b[0])));
export class BroadcastError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

export function planBroadcastRecipients(rows: { id: number; name: string; email: string | null }[]) {
  const seen = new Set<string>();
  return rows.map(row => {
    const email = validEmail.safeParse(row.email);
    const normalized = email.success ? email.data.toLowerCase() : null;
    const error = !normalized ? "Missing or invalid email address"
      : seen.has(normalized) ? "Duplicate address — another selected client already receives this email" : null;
    if (normalized) seen.add(normalized);
    return { clientId: row.id, clientName: row.name, email: normalized ?? row.email,
      status: (error ? "skipped" : "pending") as "skipped" | "pending", error };
  });
}

function countsFor(rows: Pick<Recipient, "status">[]): BroadcastCounts {
  const count = (status: Recipient["status"]) => rows.filter(row => row.status === status).length;
  return { total: rows.length, sendable: rows.length - count("skipped"), skipped: count("skipped"),
    pending: count("pending"), sent: count("sent"), failed: count("failed"), unconfirmed: count("unconfirmed") };
}
function summary(job: Job, counts: BroadcastCounts): BroadcastSummary {
  return { id: job.id, subject: job.subject, body: job.body, templateName: job.templateName, filters: job.filters,
    status: job.status, createdBy: job.createdBy, createdByName: job.createdByName,
    createdAt: job.createdAt.toISOString(), confirmedAt: job.confirmedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null, counts };
}

export function createEmailBroadcastService({
  database = db, send = sendResendEmail,
}: { database?: Database; send?: (params: ResendEmailParams) => Promise<string> } = {}) {
  async function admin(actorId: string, store: Database = database) {
    const [actor] = await store.select().from(users).where(eq(users.id, actorId));
    if (!actor || actor.role !== "admin" || actor.status !== "active") throw new BroadcastError(403, "Active administrators only");
    return actor;
  }
  async function matching(filters: BroadcastFilters, clientIds?: number[] | null, store: Database = database) {
    return store.select({ id: clients.id, name: clients.name, email: clients.email,
      status: clients.status, assignedProcessor: clients.assignedProcessor }).from(clients).where(and(
      filters.search ? or(ilike(clients.name, `%${filters.search}%`), ilike(clients.email, `%${filters.search}%`)) : undefined,
      filters.status ? eq(clients.status, filters.status) : undefined,
      filters.assignedProcessor ? eq(clients.assignedProcessor, filters.assignedProcessor) : undefined,
      clientIds ? inArray(clients.id, clientIds) : undefined,
    )).orderBy(asc(clients.id));
  }
  async function detail(id: string, store: Database = database): Promise<BroadcastDetail> {
    const [job] = await store.select().from(emailBroadcasts).where(eq(emailBroadcasts.id, id));
    if (!job) throw new BroadcastError(404, "Broadcast not found");
    const rows = await store.select().from(emailBroadcastRecipients).where(eq(emailBroadcastRecipients.broadcastId, id))
      .orderBy(asc(emailBroadcastRecipients.id));
    return { broadcast: summary(job, countsFor(rows)), recipients: rows.map(row => ({
      id: row.id, clientId: row.clientId, clientName: row.clientName, email: row.email,
      status: row.status, error: row.error, providerMessageId: row.providerMessageId, sentAt: row.sentAt?.toISOString() ?? null,
    })) };
  }
  return {
    async options(actorId: string) {
      await admin(actorId);
      const agents = await database.select({ id: users.id,
        name: sql<string>`coalesce(nullif(trim(concat_ws(' ', ${users.firstName}, ${users.lastName})), ''), ${users.email})` })
        .from(users).where(and(eq(users.status, "active"), eq(users.isTestAccount, false))).orderBy(asc(users.firstName));
      return { statuses: ["new_client", "active", "inactive"], agents };
    },
    async recipients(actorId: string, filters: unknown) {
      await admin(actorId);
      const rows = await matching(broadcastFiltersSchema.parse(filters));
      const plan = planBroadcastRecipients(rows);
      return { clients: rows.map((row, i) => ({ ...row, canSend: plan[i].status === "pending", skipReason: plan[i].error })),
        counts: { matched: rows.length, sendable: plan.filter(row => row.status === "pending").length,
          skipped: plan.filter(row => row.status === "skipped").length } };
    },
    async preview(actorId: string, input: unknown) {
      const actor = await admin(actorId);
      const draft = broadcastDraftSchema.parse(input);
      // Canonicalize selection/order so equivalent retries reserve only one draft.
      draft.clientIds = draft.clientIds ? [...new Set(draft.clientIds)].sort((a, b) => a - b) : undefined;
      const fingerprint = digest({ subject: draft.subject, body: draft.body, templateName: draft.templateName ?? null,
        filters: { search: draft.filters.search ?? "", status: draft.filters.status ?? "", assignedProcessor: draft.filters.assignedProcessor ?? "" },
        clientIds: draft.clientIds ?? null });
      return database.transaction(async tx => {
        const rows = await matching(draft.filters, draft.clientIds, tx);
        if (!rows.length) throw new BroadcastError(400, "No clients match this selection");
        const [job] = await tx.insert(emailBroadcasts).values({ id: randomUUID(), requestId: draft.requestId, fingerprint,
          recipientFingerprint: recipientDigest(rows), subject: draft.subject, body: draft.body,
          templateName: draft.templateName ?? null, filters: draft.filters, clientIds: draft.clientIds ?? null,
          createdBy: actor.id, createdByName: [actor.firstName, actor.lastName].filter(Boolean).join(" ") || "Administrator",
        }).onConflictDoNothing({ target: emailBroadcasts.requestId }).returning();
        if (!job) {
          const [existing] = await tx.select().from(emailBroadcasts).where(eq(emailBroadcasts.requestId, draft.requestId));
          if (!existing || existing.createdBy !== actorId || existing.fingerprint !== fingerprint) {
            throw new BroadcastError(409, "This request ID belongs to a different broadcast. Preview the changed draft again.");
          }
          return detail(existing.id, tx);
        }
        const plan = planBroadcastRecipients(rows);
        // Chunk database inserts, not email sends; no provider calls occur during preview.
        for (let i = 0; i < plan.length; i += 500) {
          await tx.insert(emailBroadcastRecipients).values(plan.slice(i, i + 500).map(row => ({ ...row, broadcastId: job.id })));
        }
        return detail(job.id, tx);
      });
    },
    async confirm(actorId: string, id: string, recipientCount: number) {
      await admin(actorId);
      return database.transaction(async tx => {
        const [job] = await tx.select().from(emailBroadcasts).where(eq(emailBroadcasts.id, id)).for("update");
        if (!job) throw new BroadcastError(404, "Broadcast not found");
        if (job.createdBy !== actorId) throw new BroadcastError(403, "Only the administrator who previewed this message may confirm it");
        if (job.status !== "draft") {
          if (["queued", "sending", "completed"].includes(job.status)) return detail(id, tx);
          throw new BroadcastError(409, "This broadcast was cancelled");
        }
        if (Date.now() - job.createdAt.getTime() > MAX_DRAFT_AGE_MS) throw new BroadcastError(409, "Preview expired. Preview the recipients again before sending.");
        const rows = await matching(job.filters, job.clientIds, tx);
        if (recipientDigest(rows) !== job.recipientFingerprint) throw new BroadcastError(409, "Recipients changed. Preview the selection again before sending.");
        const result = await detail(id, tx);
        if (!result.broadcast.counts.sendable) throw new BroadcastError(400, "No valid unique email addresses in this selection");
        if (recipientCount !== result.broadcast.counts.sendable) throw new BroadcastError(409, "Recipient count changed. Preview the selection again.");
        await tx.update(emailBroadcasts).set({ status: "queued", confirmedAt: new Date() }).where(eq(emailBroadcasts.id, id));
        return detail(id, tx);
      });
    },
    async cancel(actorId: string, id: string) {
      await admin(actorId);
      return database.transaction(async tx => {
        const [job] = await tx.select().from(emailBroadcasts).where(eq(emailBroadcasts.id, id)).for("update");
        if (!job) throw new BroadcastError(404, "Broadcast not found");
        if (job.status === "completed" || job.status === "cancelled") return detail(id, tx);
        await tx.update(emailBroadcasts).set({ status: "cancelled", completedAt: new Date() }).where(eq(emailBroadcasts.id, id));
        await tx.update(emailBroadcastRecipients).set({ status: "skipped", error: "Cancelled before sending" })
          .where(and(eq(emailBroadcastRecipients.broadcastId, id), eq(emailBroadcastRecipients.status, "pending")));
        return detail(id, tx);
      });
    },
    async read(actorId: string, id: string) { await admin(actorId); return detail(id); },
    async list(actorId: string) {
      await admin(actorId);
      const jobs = await database.select().from(emailBroadcasts).orderBy(desc(emailBroadcasts.createdAt)).limit(50);
      if (!jobs.length) return [];
      const rows = await database.select({ broadcastId: emailBroadcastRecipients.broadcastId, status: emailBroadcastRecipients.status })
        .from(emailBroadcastRecipients).where(inArray(emailBroadcastRecipients.broadcastId, jobs.map(job => job.id)));
      return jobs.map(job => summary(job, countsFor(rows.filter(row => row.broadcastId === job.id))));
    },
    // Globally serialized across processes. A DB transaction lock is released on
    // crash; retries reuse the same durable transport key and immutable payload.
    async tick() {
      return database.transaction(async tx => {
        const lock = await tx.execute<{ acquired: boolean }>(sql`SELECT pg_try_advisory_xact_lock(${WORKER_LOCK}) AS acquired`);
        if (!lock.rows[0]?.acquired) return false;
        const [dispatch] = await tx.select().from(emailBroadcastDispatch).where(eq(emailBroadcastDispatch.id, 1));
        if (!dispatch) throw new Error("Broadcast dispatch state is missing; apply the broadcast migration");
        const clock = await tx.execute<{ ready: boolean }>(sql`SELECT ${dispatch.nextSendAt}::timestamp <= clock_timestamp() AS ready`);
        if (!clock.rows[0]?.ready) return false;
        const [job] = await tx.select().from(emailBroadcasts).where(inArray(emailBroadcasts.status, ["queued", "sending"]))
          .orderBy(asc(emailBroadcasts.confirmedAt), asc(emailBroadcasts.id)).limit(1).for("update");
        if (!job) return false;
        const [actor] = await tx.select().from(users).where(eq(users.id, job.createdBy));
        const stopReason = !actor || actor.role !== "admin" || actor.status !== "active"
          ? "Sender is no longer an active administrator; broadcast cancelled"
          : !job.confirmedAt || Date.now() - job.confirmedAt.getTime() > MAX_SEND_AGE_MS
            ? "Safe retry window expired; verify prior delivery before creating a new broadcast" : null;
        if (stopReason) {
          await tx.update(emailBroadcastRecipients).set({ status: "failed", error: stopReason })
            .where(and(eq(emailBroadcastRecipients.broadcastId, job.id), eq(emailBroadcastRecipients.status, "pending")));
          await tx.update(emailBroadcasts).set({ status: "completed", completedAt: new Date() }).where(eq(emailBroadcasts.id, job.id));
          return false;
        }
        const [recipient] = await tx.select().from(emailBroadcastRecipients).where(and(
          eq(emailBroadcastRecipients.broadcastId, job.id), eq(emailBroadcastRecipients.status, "pending"),
        )).orderBy(asc(emailBroadcastRecipients.id)).limit(1).for("update");
        if (!recipient) {
          await tx.update(emailBroadcasts).set({ status: "completed", completedAt: new Date() }).where(eq(emailBroadcasts.id, job.id));
          return false;
        }
        const current = recipient.clientId ? await matching(job.filters, [recipient.clientId], tx) : [];
        if (!current[0] || current[0].email?.trim().toLowerCase() !== recipient.email) {
          await tx.update(emailBroadcastRecipients).set({ status: "skipped", error: "Client no longer matches the confirmed selection or email changed; skipped" })
            .where(eq(emailBroadcastRecipients.id, recipient.id));
          return false;
        }
        await tx.update(emailBroadcasts).set({ status: "sending" }).where(eq(emailBroadcasts.id, job.id));
        let failed = false;
        try {
          // Privacy boundary: precisely one To address; never CC or BCC.
          const email = validEmail.parse(recipient.email);
          const content = emailTemplateInputSchema.pick({ subject: true, body: true }).parse({
            subject: personalizeEmail(job.subject, recipient.clientName), body: personalizeEmail(job.body, recipient.clientName),
          });
          const messageId = await send({ to: email, subject: content.subject, text: content.body,
            idempotencyKey: `broadcast/${job.id}/${recipient.id}`,
            emailLog: { sentByUserId: job.createdBy, entityType: recipient.clientId ? "carrier" : undefined,
              entityId: recipient.clientId ?? undefined, templateName: "client_broadcast" } });
          await tx.update(emailBroadcastRecipients).set({ status: "sent", providerMessageId: messageId, sentAt: new Date(), error: null })
            .where(eq(emailBroadcastRecipients.id, recipient.id));
        } catch (error) {
          failed = true;
          const uncertain = error instanceof ResendDeliveryError && error.uncertain;
          await tx.update(emailBroadcastRecipients).set({ status: uncertain ? "unconfirmed" : "failed",
            error: error instanceof Error ? error.message.slice(0, 2000) : "Email send failed" }).where(eq(emailBroadcastRecipients.id, recipient.id));
        }
        // No bursts after restart. Provider failures back off instead of flooding.
        await tx.update(emailBroadcastDispatch).set({
          nextSendAt: sql`clock_timestamp() + ${failed ? 30000 : BROADCAST_GAP_MS} * interval '1 millisecond'`,
        }).where(eq(emailBroadcastDispatch.id, 1));
        const [remaining] = await tx.select({ id: emailBroadcastRecipients.id }).from(emailBroadcastRecipients)
          .where(and(eq(emailBroadcastRecipients.broadcastId, job.id), eq(emailBroadcastRecipients.status, "pending"))).limit(1);
        if (!remaining) await tx.update(emailBroadcasts).set({ status: "completed", completedAt: new Date() }).where(eq(emailBroadcasts.id, job.id));
        return true;
      });
    },
  };
}

export const emailBroadcastService = createEmailBroadcastService();
let worker: ReturnType<typeof setInterval> | undefined;
export function startEmailBroadcastWorker() {
  if (worker) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await emailBroadcastService.tick(); }
    catch (error) { console.error("[emailBroadcast] worker failed:", error instanceof Error ? error.message : "Unknown error"); }
    finally { busy = false; }
  };
  worker = setInterval(() => void tick(), 1000);
  worker.unref();
  void tick();
  console.log("[emailBroadcast] durable admin-only queue started; individual emails, minimum 2s gap");
}
