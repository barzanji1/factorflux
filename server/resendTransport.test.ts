import { test } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  createResendTransport, ResendDeliveryError,
  SYSTEM_EMAIL_FROM, SYSTEM_EMAIL_REPLY_TO, type ResendProxy, type EmailLogRecorder,
} from "./resendTransport.js";

const recorder: EmailLogRecorder = {
  async begin() { return 1; }, async accepted() {}, async failed() {},
};
const makeTransport = (proxy: ResendProxy, timeout = 30000) => createResendTransport(proxy, timeout, recorder);

const message = { to: "delivered@resend.dev", subject: "Transport test", text: "Test only" };
const accepted = () => new Response(JSON.stringify({ id: "test-provider-id" }), { status: 200 });

test("sole transport fixes sender identity, normalizes attachments, and returns acceptance ID", async () => {
  let captured: { connector: string; path: string; options: Parameters<ResendProxy>[2] } | undefined;
  const send = makeTransport(async (connector, path, options) => {
    captured = { connector, path, options };
    return accepted();
  });
  const attachment = { content: "aGVsbG8=", filename: "receipt.pdf", type: "application/pdf", disposition: "attachment" };
  const logo = { content: "aW1hZ2U=", filename: "logo.png", type: "image/png", disposition: "inline", content_id: "logo" };
  const attempt = {
    ...message, from: "spoof@example.com", replyTo: "spoof@example.com",
    html: '<img src="cid:logo">', attachments: [attachment, logo], idempotencyKey: "test/stable",
  };
  assert.equal(await send(attempt), "test-provider-id");
  assert.equal(captured?.connector, "resend");
  assert.equal(captured?.path, "/emails");
  assert.equal(captured?.options.headers["Idempotency-Key"], "test/stable");
  assert.deepEqual(captured?.options.body, {
    from: SYSTEM_EMAIL_FROM, to: [message.to], reply_to: SYSTEM_EMAIL_REPLY_TO,
    subject: message.subject, text: message.text, html: attempt.html,
    attachments: [
      { content: attachment.content, filename: attachment.filename, content_type: attachment.type },
      { content: logo.content, filename: logo.filename, content_type: logo.type, content_id: "logo" },
    ],
    tags: [{ name: "email_log_key", value: createHash("sha256").update("test/stable.").update(JSON.stringify({
      from: SYSTEM_EMAIL_FROM, to: [message.to], reply_to: SYSTEM_EMAIL_REPLY_TO, subject: message.subject,
      text: message.text, html: attempt.html, attachments: [
        { content: attachment.content, filename: attachment.filename, content_type: attachment.type },
        { content: logo.content, filename: logo.filename, content_type: logo.type, content_id: "logo" },
      ],
    })).digest("hex") }],
  });
});

test("durable draft keys are preserved and independent system sends get distinct keys", async () => {
  const keys: string[] = [];
  const send = makeTransport(async (_connector, _path, options) => {
    keys.push(options.headers["Idempotency-Key"]);
    return accepted();
  });
  await send({ ...message, idempotencyKey: "draft/unchanged" });
  await send({ ...message, idempotencyKey: "draft/unchanged" });
  await send(message);
  await send(message);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[2], keys[3]);
});

test("provider rejection is explicit; no alternate or log-only success", async () => {
  const send = makeTransport(async () =>
    new Response(JSON.stringify({ message: "Domain not authorized" }), { status: 403 }));
  await assert.rejects(send(message), error =>
    error instanceof ResendDeliveryError && error.statusCode === 502 &&
    !error.uncertain && /Domain not authorized/.test(error.message));
});

test("server errors, malformed acceptance, and network failures remain unconfirmed", async () => {
  const proxies: ResendProxy[] = [
    async () => new Response(JSON.stringify({ message: "Provider unavailable" }), { status: 500 }),
    async () => new Response(JSON.stringify({}), { status: 200 }),
    async () => new Response("not JSON", { status: 200 }),
    async () => { throw new Error("Network interruption"); },
  ];
  for (const proxy of proxies) {
    await assert.rejects(makeTransport(proxy)(message), error =>
      error instanceof ResendDeliveryError && error.statusCode === 503 && error.uncertain);
  }
});

test("a timed-out provider request is unconfirmed, not sent", async () => {
  const send = makeTransport(() => new Promise<Response>(() => {}), 10);
  await assert.rejects(send(message), error =>
    error instanceof ResendDeliveryError && error.uncertain);
});
