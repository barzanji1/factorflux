import { test } from "node:test";
import assert from "node:assert/strict";
import { createResendTransport, type EmailLogRecorder } from "./resendTransport.js";
import { wrapEmail, textToEmailBody, emailDisplayName, paymentInstructions, configuredPaymentBody, hasUnsafePaymentInstructions, prepareBrandedEmail, EMAIL_LOGO_CID } from "./emailTemplate.js";

test("shared shell has responsive branding, safe text, clean tables, footer and no Win95 theme", () => {
  const body = textToEmailBody("Hi TEST PILOT CARRIER LLC,\n\nInvoice #: INV-9001\nLoad #: 150611\nAmount: $125.50\n\nPlease send <documents>.");
  const html = wrapEmail('Invoice <review>', body);
  assert.match(html, /#27aab8/);
  assert.match(html, /max-width:600px/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /Hi Test Pilot Carrier LLC,/);
  assert.match(html, /<strong>INV-9001<\/strong>/);
  assert.match(html, /<strong>150611<\/strong>/);
  assert.match(html, /&lt;documents&gt;/);
  assert.match(html, /dosh@truckingprosfinancial.com/);
  assert.match(html, /385-495-4962/);
  assert.doesNotMatch(html, /gradient|outset|inset|unsubscribe/i);
  assert.equal(wrapEmail("ignored", html), html);
  assert.equal(emailDisplayName("TRANSJET CARGO LLC"), "Transjet Cargo LLC");
});

test("payment instructions require all three configuration values and retire queued fake instructions", () => {
  assert.equal(paymentInstructions({}), "");
  assert.equal(paymentInstructions({ COMPANY_ROUTING: "111000111", COMPANY_ACCOUNT: "987654321" }), "");
  const configured = { COMPANY_ROUTING: "111000111", COMPANY_ACCOUNT: "987654321", COMPANY_ADDRESS: "Test address" };
  assert.match(paymentInstructions(configured), /111000111/);
  const queued = "Please pay.\nPayment instructions:\nACH Routing: 021000021 · Account: 1234567890\nOr mail check to: 1234 Factoring Lane, Dallas\nThank you.";
  assert.equal(configuredPaymentBody(queued, {}), "Please pay.\n\nThank you.");
  assert.doesNotMatch(configuredPaymentBody(queued, configured), /021000021|1234567890|1234 Factoring Lane/);
  const realBank = { ...configured, COMPANY_ROUTING: "021000021" };
  const realInstructions = paymentInstructions(realBank);
  assert.equal(configuredPaymentBody(realInstructions, realBank), realInstructions);
  assert.equal(hasUnsafePaymentInstructions(realInstructions), false);
});

test("legacy invoice-detail paragraphs become the same bordered table", () => {
  const html = wrapEmail("Submission update", '<div><p><strong>Load #:</strong> 150611</p><p><strong>Invoice #:</strong> INV-9001</p><p><strong>Amount:</strong> $125.50</p></div>');
  assert.match(html, /<th[^>]*>Load #<\/th>/);
  assert.match(html, /<strong>INV-9001<\/strong>/);
  assert.doesNotMatch(html, /<p><strong>Load #:/);
});

test("pre-wrapped bodies receive exactly one logo; wrapped payloads remain immutable", () => {
  const params = { to: "test@example.com", subject: "Test", html: wrapEmail("Test", "<p>Hello</p>") };
  const prepared = prepareBrandedEmail(params);
  assert.equal(prepared.attachments?.filter(attachment => attachment.content_id === EMAIL_LOGO_CID).length, 1);
  assert.deepEqual(prepareBrandedEmail(prepared), prepared);
});

test("direct transport calls and text-only messages are branded before durable logging and sending", async () => {
  let logged: any, sent: any;
  const recorder: EmailLogRecorder = {
    async begin(params) { logged = params; return 1; }, async accepted() {}, async failed() {},
  };
  const send = createResendTransport(async (_connector, _path, request) => {
    sent = request.body;
    return new Response(JSON.stringify({ id: "brand-test-id" }), { status: 200 });
  }, 1000, recorder);
  await send({ to: "test@example.com", subject: "Test", text: "Invoice #: TEST-1001" });
  assert.match(sent.html, /data-tpf-email="1"/);
  assert.match(logged.html, /data-tpf-email="1"/);
  assert.equal(sent.attachments[0].content_id, EMAIL_LOGO_CID);
  assert.equal(sent.text, "Invoice #: TEST-1001");
});

test("historical payloads retry unchanged and unsafe payment defaults never reach the provider", async () => {
  let sent: any, failed = false;
  const original = { to: "test@example.com", subject: "Old", text: "Original text" };
  const recorder: EmailLogRecorder = {
    async originalPayload() { return original; },
    async begin() { return 2; }, async accepted() {}, async failed() { failed = true; },
  };
  const send = createResendTransport(async (_connector, _path, request) => {
    sent = request.body; return new Response(JSON.stringify({ id: "old-id" }), { status: 200 });
  }, 1000, recorder);
  await send(original);
  assert.equal(sent.html, undefined);
  assert.equal(sent.text, original.text);
  sent = undefined;
  await assert.rejects(send({ to: "test@example.com", subject: "Unsafe", text: "Routing: 021000021 · Account: 1234567890" }), /retired placeholder/);
  assert.equal(sent, undefined);
  assert.equal(failed, true);
});
