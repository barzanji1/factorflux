import test from "node:test";
import assert from "node:assert/strict";
import { classifyDocumentAI, CLASSIFIER_MODEL, reviewDocumentType } from "./aiClassifier";

const prediction = {
  docType: "carrier_invoice", confidence: .97, signals: ["Carrier invoice heading"],
  reasoning: "Carrier requests freight payment",
  allScores: { rate_confirmation: .01, carrier_invoice: .97, bol_pod: .01, other: .01 },
};
function response(input: unknown, stopReason = "tool_use") {
  return new Response(JSON.stringify({
    id: "fixture", type: "message", role: "assistant", model: CLASSIFIER_MODEL,
    content: [{ type: "tool_use", id: "classify", name: "classify_document", input }],
    stop_reason: stopReason, usage: { input_tokens: 20, output_tokens: 50 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}
test("Claude uses requested model/enum and preserves the existing result and review interfaces", async context => {
  let body: any;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    body = JSON.parse(String(init.body)); return response(prediction);
  });
  const result = await classifyDocumentAI("First page invoice text");
  assert.equal(body.model, "claude-haiku-4-5");
  assert.equal(body.messages[0].content, "First page invoice text");
  assert.deepEqual(body.tools[0].input_schema.properties.docType.enum, ["rate_confirmation", "carrier_invoice", "bol_pod", "other"]);
  assert.equal(result.docType, "carrier_invoice");
  assert.equal(result.source, "ai");
  assert.equal(result.confidence, .97);
  assert.equal(result.allScores.freight_invoice, .97);
  assert.equal(reviewDocumentType(result.docType), "freight_invoice");
  assert.equal(reviewDocumentType("bol_pod"), "bill_of_lading");
});
for (const invalid of [
  { ...prediction, docType: "freight_invoice" },
  { ...prediction, confidence: 1.2 },
  { ...prediction, confidence: -.1 },
  { ...prediction, confidence: "0.97" },
  { ...prediction, allScores: { ...prediction.allScores, other: -1 } },
]) {
  test("invalid enum/confidence response fails instead of selecting rules", async context => {
    context.mock.method(globalThis, "fetch", async () => response(invalid));
    await assert.rejects(classifyDocumentAI("Invoice #9", undefined, { requireAI: false }), /invalid enum/);
  });
}
for (const status of [401, 429, 500]) {
  test(`Claude HTTP ${status} errors propagate without retry or rule fallback`, async context => {
    let calls = 0;
    context.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "Fixture error" } }),
        { status, headers: { "content-type": "application/json" } });
    });
    await assert.rejects(classifyDocumentAI("Invoice #9"), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  });
}
test("truncated Claude output fails visibly", async context => {
  context.mock.method(globalThis, "fetch", async () => response(prediction, "max_tokens"));
  await assert.rejects(classifyDocumentAI("Invoice #9"), /incomplete/);
});
