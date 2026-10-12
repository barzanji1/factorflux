import { createHmac, timingSafeEqual } from "node:crypto";

export class WebhookVerificationError extends Error {}
export function verifyResendWebhook(raw: Buffer, headers: { id?: string; timestamp?: string; signature?: string }, secret: string, now = Date.now()) {
  if (!secret.startsWith("whsec_")) throw new WebhookVerificationError("Webhook signing secret is not configured correctly");
  if (!headers.id || headers.id.length > 256 || !headers.timestamp || !/^\d+$/.test(headers.timestamp) || !headers.signature) {
    throw new WebhookVerificationError("Missing signature headers");
  }
  const stamp = Number(headers.timestamp);
  if (!Number.isSafeInteger(stamp) || Math.abs(now / 1000 - stamp) > 300) throw new WebhookVerificationError("Expired webhook signature");
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.length < 16) throw new WebhookVerificationError("Invalid signing secret");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.`).update(raw).digest();
  const valid = headers.signature.split(/\s+/).some(part => {
    const [version, encoded] = part.split(",");
    if (version !== "v1" || !encoded) return false;
    const signature = Buffer.from(encoded, "base64");
    return signature.length === expected.length && timingSafeEqual(signature, expected);
  });
  if (!valid) throw new WebhookVerificationError("Invalid webhook signature");
  return JSON.parse(raw.toString("utf8")) as unknown;
}
