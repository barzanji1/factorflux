import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { clientEmailLogs, type ClientEmailLog } from "@shared/schema";

export const CLIENT_EMAIL_FROM = "TruckingPros Financial <clients@truckingprosfinancial.com>";
export const CLIENT_EMAIL_REPLY_TO = "dosh@truckingprosfinancial.com";
export const clientEmailSchema = z.object({
  clientId: z.number().int().positive(),
  requestId: z.string().uuid(),
  subject: z.string().trim().min(1, "Subject is required").max(200).refine(value => !/[\r\n]/.test(value), "Subject must be a single line"),
  body: z.string().trim().min(1, "Message is required").max(20000),
}).strict();
export type ClientEmailInput = z.infer<typeof clientEmailSchema>;
type Draft = typeof clientEmailLogs.$inferInsert;

export class ClientEmailError extends Error {
  constructor(public statusCode: number, message: string, public uncertain = false) { super(message); }
}

type Proxy = (connector: string, path: string, options: {
  method: string; headers: Record<string, string>; body: unknown;
}) => Promise<Response>;
const connectors = new ReplitConnectors();

export function createResendSender(proxy: Proxy = connectors.proxy.bind(connectors)) {
  return async (log: ClientEmailLog): Promise<string> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        proxy("resend", "/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": `client-email/${log.requestId}` },
          body: {
            from: log.fromEmail, to: [log.toEmail], reply_to: log.replyTo,
            subject: log.subject, text: log.body,
          },
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new ClientEmailError(503, "Email delivery could not be confirmed. Check Communications before starting a new email; retry only this unchanged draft.", true)), 30000);
        }),
      ]);
      const payload = await response.json() as { id?: string; message?: string };
      if (!response.ok) {
        throw new ClientEmailError(response.status >= 500 ? 503 : 502,
          `Resend did not confirm sending: ${payload.message || `provider error ${response.status}`}`,
          response.status >= 500);
      }
      if (!payload.id) throw new ClientEmailError(503, "Resend returned no message ID. Delivery is unconfirmed; check Communications before starting a new email.", true);
      return payload.id;
    } catch (error) {
      if (error instanceof ClientEmailError) throw error;
      throw new ClientEmailError(503, "Email delivery could not be confirmed. Check Communications before starting a new email; retry only this unchanged draft.", true);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
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
      subject: input.subject, body: input.body, status: "pending",
    });
    if (log.clientId !== client.id || log.agentId !== agent.id || log.subject !== input.subject ||
        log.body !== input.body || log.toEmail !== toEmail.data) {
      throw new ClientEmailError(409, "This send request belongs to a different email. Start a new draft before sending.");
    }
    if (log.status === "sent") return log;
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