import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { resolveEmailConfig } from "../shared/email-config.js";

const config = resolveEmailConfig(process.env);
export const SYSTEM_EMAIL_FROM = config.from;
export const SYSTEM_EMAIL_REPLY_TO = config.replyTo;
const connectors = new ReplitConnectors();

export class ResendDeliveryError extends Error {
  constructor(statusCode, message, uncertain = false) {
    super(message);
    this.name = "ResendDeliveryError";
    this.statusCode = statusCode;
    this.uncertain = uncertain;
  }
}

// The sole outbound email transport. Callers cannot override sender identity.
// A caller with a durable draft supplies its existing idempotency key.
export function createResendTransport(proxy = connectors.proxy.bind(connectors), timeoutMs = 30000) {
  return async function send(params) {
    const body = {
      from: SYSTEM_EMAIL_FROM,
      to: [params.to],
      reply_to: SYSTEM_EMAIL_REPLY_TO,
      subject: params.subject,
    };
    if (params.text !== undefined) body.text = params.text;
    if (params.html !== undefined) body.html = params.html;
    if (params.attachments?.length) {
      body.attachments = params.attachments.map(attachment => ({
        content: attachment.content,
        filename: attachment.filename,
        ...(attachment.type ? { content_type: attachment.type } : {}),
        ...(attachment.content_id ? { content_id: attachment.content_id } : {}),
      }));
    }
    let timeout;
    try {
      const response = await Promise.race([
        proxy("resend", "/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": params.idempotencyKey ?? `system-email/${randomUUID()}`,
          },
          body,
        }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new ResendDeliveryError(503,
            "Email delivery could not be confirmed. Check the previous attempt before starting a new email; retry only the unchanged draft.", true)), timeoutMs);
        }),
      ]);
      const payload = await response.json();
      if (!response.ok) {
        throw new ResendDeliveryError(response.status >= 500 ? 503 : 502,
          `Resend did not confirm sending: ${payload?.message || `provider error ${response.status}`}`,
          response.status >= 500);
      }
      if (typeof payload?.id !== "string" || !payload.id) {
        throw new ResendDeliveryError(503, "Resend returned no message ID. Delivery is unconfirmed; check the previous attempt before starting a new email.", true);
      }
      return payload.id;
    } catch (error) {
      if (error instanceof ResendDeliveryError) throw error;
      throw new ResendDeliveryError(503,
        "Email delivery could not be confirmed. Check the previous attempt before starting a new email; retry only the unchanged draft.", true);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}

export const sendResendEmail = createResendTransport();
