import { test } from "node:test";
import assert from "node:assert/strict";
import { newOcrTrace, withOcrTrace, currentOcrTrace, timeOcrStage, startOcrStage } from "./ocrPipelineTiming";

test("timings preserve values/errors, isolate concurrent traces and log no payloads", async t => {
  const output = t.mock.method(console, "info", () => {});
  const a = newOcrTrace(), b = newOcrTrace();
  const secret = new Error("sensitive provider error");
  await Promise.all([
    withOcrTrace(a, async () => {
      const value = await timeOcrStage("S3 Upload", async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(currentOcrTrace(), a);
        return "private content";
      });
      assert.equal(value, "private content");
    }),
    withOcrTrace(b, async () => {
      await assert.rejects(timeOcrStage("Textract API Call", async () => { throw secret; }),
        error => error === secret);
      const finish = startOcrStage("File Receive/Validation");
      finish();
      finish("failed");
    }),
  ]);
  assert.equal(output.mock.calls.length, 3);
  assert.equal(currentOcrTrace(), undefined);
  const logs = JSON.stringify(output.mock.calls.map(call => call.arguments));
  assert(!logs.includes("private content") && !logs.includes("sensitive provider error"));
  assert(logs.includes(a.id) && logs.includes(b.id));
  for (const call of output.mock.calls) {
    assert.match(call.arguments[0], /^\[OCR Pipeline\] Stage: .+ — [\d,]+ms$/);
    assert.deepEqual(Object.keys(call.arguments[1]).sort(), ["outcome", "traceId"]);
  }
});
