import test from "node:test";
import assert from "node:assert/strict";
import { failedOcrAlerts } from "./invoiceOcrAlerts";

test("failed OCR is an informational invoice alert with error and retry destination", () => {
  const alerts = failedOcrAlerts([{ status: "failed", originalName: "invoice.pdf", errorMessage: "Access denied" }]);
  assert.equal(alerts[0].code, "DOCS_OCR_FAILED");
  assert.equal(alerts[0].severity, "info");
  assert.match(alerts[0].message, /invoice.pdf: Access denied/);
  assert.equal(alerts[0].link, "/documents");
});

test("successful or in-progress latest attempts do not keep stale failure alerts", () => {
  assert.deepEqual(failedOcrAlerts([
    { status: "completed", originalName: "invoice.pdf", errorMessage: null },
    { status: "processing", originalName: "bol.pdf", errorMessage: null },
  ]), []);
});
