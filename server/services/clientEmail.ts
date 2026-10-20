import { createResendTransport, sendResendEmail, ResendDeliveryError as ClientEmailError, type ResendProxy, type EmailLogRecorder } from "../resendTransport.js";
import { and, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { clientEmailLogs, type ClientEmailLog } from "@shared/schema";
import { SYSTEM_EMAIL_FROM, SYSTEM_EMAIL_REPLY_TO } from "../emailConfig";

export const CLIENT_EMAIL_FROM = SYSTEM_EMAIL_FROM;
export const CLIENT_EMAIL_REPLY_TO = SYSTEM_EMAIL_REPLY_TO;
export const clientEmailSchema = z.object({
  clientId: z.number().int().positive(),
  requestId: z.string().uuid(),
  subject: z.string().trim().min(1, "Subject is required").max(200).refine(value => !/[\r\n]/.test(value), "Subject must be a single line"),
  body: z.string().trim().min(1, "Message is required").max(20000),
  cc: z.array(z.string().trim().email("Enter a valid CC email address").max(254))
    .max(20, "Use no more than 20 CC addresses").optional()
    .transform(values => [...new Set((values ?? []).map(value => value.toLowerCase()))].sort()),
}).strict();
export type ClientEmailInput = z.infer<typeof clientEmailSchema>;
type Draft = typeof clientEmailLogs.$inferInsert;

export { ClientEmailError };

export function createResendSender(proxy?: ResendProxy, recorder?: EmailLogRecorder) {
  const send = proxy ? createResendTransport(proxy, 30000, recorder) : sendResendEmail;
  return (log: ClientEmailLog) => send({
    to: log.toEmail, cc: log.ccEmails ?? [], subject: log.subject, text: log.body,
    idempotencyKey: `client-email/${log.requestId}`,
    emailLog: { sentByUserId: log.agentId, entityType: "carrier", entityId: log.clientId, templateName: "client_email" },
  });
}

export interface ClientEmailStore {
  reserve(draft: Draft): Promise<ClientEmailLog>;
  claim(id: number): Promise<ClientEmailLog | undefined>;
  update(id: number, fields: Partial<ClientEmailLog>): Promise<ClientEmailLog>;
}

export function createClientEmailStore(database = db): ClientEmailStore {
  return {
    async reserve(draft) {
      await database.insert(clientEmailLogs).values(draft).onConflictDoNothing({ target: clientEmailLogs.requestId });
      const [log] = await database.select().from(clientEmailLogs).where(eq(clientEmailLogs.requestId, draft.requestId));
      if (!log) throw new Error("Unable to reserve email log");
      return log;
    },
    async claim(id) {
      const [log] = await database.update(clientEmailLogs).set({ status: "sending", updatedAt: new Date(), errorMessage: null })
        .where(and(eq(clientEmailLogs.id, id), or(
          eq(clientEmailLogs.status, "pending"), eq(clientEmailLogs.status, "failed"),
          eq(clientEmailLogs.status, "unconfirmed"),
          and(eq(clientEmailLogs.status, "sending"), lt(clientEmailLogs.updatedAt, new Date(Date.now() - 120000))),
        ))).returning();
      return log;
    },
    async update(id, fields) {
      const [log] = await database.update(clientEmailLogs).set({ ...fields, updatedAt: new Date() })
        .where(eq(clientEmailLogs.id, id)).returning();
      if (!log) throw new Error("Unable to update email log");
      return log;
    },
  };
}

export function createClientEmailService(store: ClientEmailStore, send: (log: ClientEmailLog) => Promise<string>) {
  return async (input: ClientEmailInput, client: { id: number; email?: string | null }, agent: { id: string; name: string }) => {
    const toEmail = z.string().trim().email().safeParse(client.email);
    if (!toEmail.success) throw new ClientEmailError(400, "This client needs a valid email address saved on their profile before you can send.");
    const log = await store.reserve({
      requestId: input.requestId, clientId: client.id, agentId: agent.id, agentName: agent.name,
      toEmail: toEmail.data, fromEmail: CLIENT_EMAIL_FROM, replyTo: CLIENT_EMAIL_REPLY_TO,
      ccEmails: (input.cc ?? []).filter(address => address.toLowerCase() !== toEmail.data.toLowerCase()),
      subject: input.subject, body: input.body, status: "pending",
    });
    if (log.clientId !== client.id || log.agentId !== agent.id || log.subject !== input.subject ||
        log.body !== input.body || log.toEmail !== toEmail.data ||
        JSON.stringify([...(log.ccEmails ?? [])].sort()) !==
          JSON.stringify((input.cc ?? []).filter(address => address.toLowerCase() !== toEmail.data.toLowerCase()).sort())) {
      throw new ClientEmailError(409, "This send request belongs to a different email. Start a new draft before sending.");
    }
    if (log.status === "sent") return log;
    if (log.fromEmail !== CLIENT_EMAIL_FROM || log.replyTo !== CLIENT_EMAIL_REPLY_TO) {
      throw new ClientEmailError(409, "Sender settings changed since this draft was started. Verify the previous attempt in Communications before starting a new draft.");
    }
    // Resend idempotency keys expire after 24 hours. Never retry an unresolved
    // request outside that window, since its original email may have been sent.
    if (Date.now() - log.createdAt.getTime() > 23 * 60 * 60 * 1000) {
      throw new ClientEmailError(409, "This older email's delivery needs manual verification before resending.");
    }
    const claimed = await store.claim(log.id);
    if (!claimed) throw new ClientEmailError(409, "This email is already being sent. Check Communications before trying again.");
    let messageId: string;
    try {
      messageId = await send(claimed);
    } catch (error) {
      const failure = error instanceof ClientEmailError ? error
        : new ClientEmailError(503, "Delivery is unconfirmed. Check Communications before starting a new email.", true);
      try {
        await store.update(log.id, { status: failure.uncertain ? "unconfirmed" : "failed", errorMessage: failure.message });
      } catch {
        throw new ClientEmailError(503, "The email attempt was recorded, but its delivery status could not be updated. Check Communications before starting a new email.", true);
      }
      throw failure;
    }
    try {
      return await store.update(log.id, { status: "sent", sentAt: new Date(), providerMessageId: messageId, errorMessage: null });
    } catch {
      throw new ClientEmailError(503, "Resend accepted this email, but the status update failed. The message and agent are logged. Retry only the unchanged draft to reconcile; do not start a new email.", true);
    }
  };
}

export const sendClientEmail = createClientEmailService(createClientEmailStore(), createResendSender());