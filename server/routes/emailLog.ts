import type { Express, RequestHandler } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { emailLog, emailLogEvents, emailRetryPayloads, users } from "../../shared/schema";
import { claimEmailRetry, EmailLogError, processResendEvent, type EmailStore } from "../services/emailLogService";
import { listEmailLog, readEmailLog } from "../services/emailLogReader";
import { verifyResendWebhook } from "../services/resendWebhook";
import { getSignedDownloadUrl } from "../services/s3Service";
import { sendResendEmail, SYSTEM_EMAIL_FROM, SYSTEM_EMAIL_REPLY_TO } from "../resendTransport.js";
import { validateEmailRetryDomain, reconcileEmailRetry, reconcileResendMessage } from "../services/emailLogReconciliation";

const id = z.coerce.number().int().positive();
export function registerEmailLogRoutes(app: Express, deps: {
  requireAuth: RequestHandler; requireManagerOrAdmin: RequestHandler; store?: EmailStore;
  send?: typeof sendResendEmail; signingSecret?: () => string | undefined; signedDownload?: typeof getSignedDownloadUrl;
}) {
  const store = deps.store ?? db, send = deps.send ?? sendResendEmail;
  const secret = deps.signingSecret ?? (() => process.env.RESEND_WEBHOOK_SECRET);
  const manage = (req: any) => ["manager", "admin"].includes(req.user.role);
  const wrap = (handler: (req: any, res: any) => Promise<unknown>): RequestHandler => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ message: "Invalid email log request", errors: error.issues });
      if (error instanceof EmailLogError) return void res.status(error.statusCode).json({ message: error.message });
      console.error("[email-log] Request failed:", error instanceof Error ? error.name : "Unknown error");
      res.status(500).json({ message: "Email log request failed" });
    }
  };
  app.post("/api/webhooks/resend", async (req: any, res) => {
    if (!secret()) return void res.status(503).json({ message: "Webhook signing is not configured" });
    let payload: unknown;
    try {
      if (!Buffer.isBuffer(req.rawBody)) throw new Error("Missing raw body");
      payload = verifyResendWebhook(req.rawBody, { id: req.get("svix-id"), timestamp: req.get("svix-timestamp"), signature: req.get("svix-signature") }, secret()!);
    } catch { return void res.status(401).json({ message: "Invalid webhook signature" }); }
    try {
      const result = await processResendEvent(req.get("svix-id")!, payload, store);
      // Re-run this on duplicate callbacks too: Resend retries if a previous
      // entity reconciliation failed after the email event was committed.
      const messageId = (payload as { data?: { email_id?: string } }).data?.email_id;
      if (messageId && !("ignored" in result)) await reconcileResendMessage(messageId, store);
      res.json(result);
    }
    catch (error) {
      res.status(error instanceof z.ZodError ? 400 : 500).json({ message: "Unable to record webhook event" });
    }
  });
  app.get("/api/email-log/integration-status", deps.requireAuth, (_req, res) => res.json({ webhookConfigured: !!secret() }));
  app.get("/api/email-log/agents", deps.requireAuth, wrap(async (_req, res) => {
    res.json(await store.selectDistinct({ id: users.id, name: sql<string>`coalesce(nullif(trim(concat_ws(' ', ${users.firstName}, ${users.lastName})), ''), 'Former staff member')`.as("name") })
      .from(users).innerJoin(emailLog, eq(emailLog.sentByUserId, users.id)).orderBy(sql`"name"`, users.id));
  }));
  app.get("/api/email-log", deps.requireAuth, wrap(async (req, res) => res.json(await listEmailLog(req.query, manage(req), store))));
  app.get("/api/email-log/:id", deps.requireAuth, wrap(async (req, res) => res.json(await readEmailLog(id.parse(req.params.id), manage(req), store))));
  app.get("/api/email-log/:id/attachments/:index", deps.requireAuth, wrap(async (req, res) => {
    const log = await readEmailLog(id.parse(req.params.id), manage(req), store);
    const attachment = log.attachments[z.coerce.number().int().min(0).parse(req.params.index)];
    if (!attachment?.s3_key) throw new EmailLogError(404, "Attachment unavailable");
    const name = attachment.filename.replace(/[\r\n"\\/]/g, "_");
    res.setHeader("Cache-Control", "no-store");
    res.redirect(await (deps.signedDownload ?? getSignedDownloadUrl)(attachment.s3_key, name, 60));
  }));
  app.post("/api/email-log/:id/resend", deps.requireAuth, deps.requireManagerOrAdmin, wrap(async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    const originalId = id.parse(req.params.id);
    const { params, rootId } = await claimEmailRetry(originalId, store);
    try {
      if (params.originalFrom !== SYSTEM_EMAIL_FROM || params.originalReplyTo !== SYSTEM_EMAIL_REPLY_TO) {
        throw new EmailLogError(409, "Sender settings changed; verify the previous attempt before sending from the linked entity.");
      }
      await validateEmailRetryDomain(params, store);
      const messageId = await send({ ...params, emailLog: { ...params.emailLog, sentByUserId: req.user.id, retryOfId: rootId } });
      const [retry] = await store.select({ id: emailRetryPayloads.resolvedById }).from(emailRetryPayloads).where(eq(emailRetryPayloads.emailLogId, rootId));
      let warning: string | undefined;
      try { await reconcileEmailRetry(params, messageId, req.user.id, store); }
      catch {
        warning = "Email was accepted, but entity tracking could not be reconciled. Check the linked entity.";
        if (retry?.id) await store.insert(emailLogEvents).values({ emailLogId: retry.id, type: "entity_sync_failed", notes: warning });
      }
      res.json({ messageId, emailLogId: retry?.id, warning });
    } catch (error) {
      await store.update(emailRetryPayloads).set({ state: "failed", lockUntil: null })
        .where(and(eq(emailRetryPayloads.emailLogId, rootId), eq(emailRetryPayloads.state, "sending")));
      if (error instanceof EmailLogError) throw error;
      throw new EmailLogError(502, error instanceof Error ? error.message : "Resend failed");
    }
  }));
  // There is intentionally no endpoint for editing or deleting history.
  for (const method of ["put", "patch", "delete"] as const) {
    app[method]("/api/email-log/:id", deps.requireAuth, (_req, res) => res.status(405).json({ message: "Email history is read-only" }));
  }
}
