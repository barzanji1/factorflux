import { randomUUID, createHash } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { resolveEmailConfig } from "../shared/email-config.js";
import { prepareBrandedEmail, hasUnsafePaymentInstructions } from "./emailTemplate.js";

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
export function createResendTransport(proxy = connectors.proxy.bind(connectors), timeoutMs = 30000, injectedRecorder) {
  return async function send(params) {
    const key = params.idempotencyKey ?? `system-email/${randomUUID()}`;
    const recorder = injectedRecorder ?? (await import("./services/emailLogService.js")).emailLogRecorder;
    const original = await recorder.originalPayload?.(key);
    // Historical retry content is immutable. New drafts always receive branding.
    if (original && !original.html?.includes('data-tpf-email="1"') &&
      original.subject === params.subject && original.html === params.html && original.text === params.text) {
      params = { ...params, html: original.html, text: original.text, attachments: original.attachments };
    } else {
      params = prepareBrandedEmail(params);
    }
    const body = {
      from: SYSTEM_EMAIL_FROM,
      to: Array.isArray(params.to) ? params.to : [params.to],
      reply_to: SYSTEM_EMAIL_REPLY_TO,
      subject: params.subject,
    };
    if (params.cc?.length) body.cc = params.cc;
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
    // Stable across retries, and body-specific: a webhook can reconcile a lost
    // acceptance response without matching by recipient or exposing a draft key.
    const correlationKey = createHash("sha256").update(key).update(".").update(JSON.stringify(body)).digest("hex");
    body.tags = [{ name: "email_log_key", value: correlationKey }];
    // Fail closed: no provider request is made unless its durable log exists.
    const attemptId = await recorder.begin(params, body, key);
    let timeout;
    let providerAccepted = false;
    try {
      if (hasUnsafePaymentInstructions(params.html) || hasUnsafePaymentInstructions(params.text)) {
        throw new ResendDeliveryError(400, "Email contains retired placeholder payment instructions. Regenerate it using configured company payment details.", false);
      }
      const previousId = await recorder.previousAcceptance?.(key, correlationKey);
      if (previousId) {
        providerAccepted = true;
        await recorder.accepted(attemptId, previousId);
        return previousId;
      }
      const response = await Promise.race([
        proxy("resend", "/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
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
      providerAccepted = true;
      await recorder.accepted(attemptId, payload.id);
      return payload.id;
    } catch (error) {
      const failure = error instanceof ResendDeliveryError ? error : new ResendDeliveryError(503,
        providerAccepted ? "Resend accepted the email, but recording acceptance failed. Retry only the unchanged message to reconcile." :
          "Email delivery could not be confirmed. Check the previous attempt before starting a new email; retry only the unchanged draft.", true);
      try { await recorder.failed(attemptId, { message: failure.message, uncertain: failure.uncertain }); }
      catch { throw new ResendDeliveryError(503, "The email attempt exists, but its delivery state could not be recorded. Check Email Log before retrying.", true); }
      throw failure;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}

export const sendResendEmail = createResendTransport();
