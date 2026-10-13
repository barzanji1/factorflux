import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { customerLogoPath } from "./customerBranding";
import { prepareBrandedEmail } from "./emailTemplate.js";
import { buildFundingReceiptPdf } from "./services/fundingReceiptService";
import { pool } from "./db";

test("customer logo and email use TPF, including legacy email subjects/body", async () => {
  assert.match(customerLogoPath()!, /tpf-logo\.png$/);
  assert.doesNotMatch(customerLogoPath()!, /ff-logo/);
  const message = prepareBrandedEmail({ to: "test@example.com", subject: "FactorFlux notice", text: "Hello from FactorFlux. Visit https://factorflux.io/portal." });
  assert.match(message.subject, /Trucking Pros Financial/);
  assert.match(message.text!, /https:\/\/factorflux.io\/portal/);
  assert.doesNotMatch(message.html!, /alt="FF"|ff-logo|FactorFlux/);
  assert.equal(message.attachments![0].filename, "tpf-logo-white.png");
});

test("all portal views use TPF; internal login/sidebar preserve FactorFlux", async () => {
  for (const file of ["client/src/pages/portal/index.tsx", "client/src/pages/portal/login.tsx", "client/src/pages/portal/register.tsx", "client/src/components/layout/portal-layout.tsx"]) {
    const source = await fs.readFile(file, "utf8");
    assert.doesNotMatch(source, /FactorFlux|ff-logo/);
    assert.match(source, /TpfLogo/);
  }
  for (const file of ["client/src/pages/login.tsx", "client/src/components/layout/sidebar.tsx"]) {
    assert.match(await fs.readFile(file, "utf8"), /ff-logo-emboss\.png/);
  }
  const broker = await fs.readFile("server/routes/brokerConfirmation.ts", "utf8");
  assert.match(broker, /rel="icon"[^>]*tpf-logo/);
  assert.match(broker, /tpf-logo-white\.png/);
  assert.match(broker, /img-src 'self'/);
  assert.doesNotMatch(broker, /FactorFlux|ff-logo/);
  const routes = await fs.readFile("server/routes.ts", "utf8");
  assert.doesNotMatch(routes, /ff-logo-emboss|text\("FactorFlux"|Generated (?:by|electronically by) FactorFlux/);
});

test("a real funding-receipt renderer emits a one-page TPF PDF without touching stored receipts", async () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const pdf = await buildFundingReceiptPdf({
    id: 1, receiptNo: "TPF-TEST", version: 1, invoiceId: 1, carrierId: 1, brokerId: 1,
    invoiceAmount: "100.00", advancePct: "95.00", feeAmount: "5.00", reserveAmount: "0.00", netFunded: "95.00",
    paymentMethod: "ach", paymentReference: "TEST ONLY", fundedAt: now, fundedByUserId: "fixture-agent",
    s3Key: "test-only/no-upload.pdf", auditHash: "test-only", createdAt: now,
  }, "TEST-1001", "Test Carrier LLC");
  await fs.mkdir("generated-artifacts/customer-branding", { recursive: true });
  const file = "generated-artifacts/customer-branding/funding-receipt.pdf";
  await fs.writeFile(file, pdf);
  const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
  assert.match(text, /Trucking Pros Financial/);
  assert.match(text, /TEST-1001/);
  assert.doesNotMatch(text, /FactorFlux/);
  assert.match(execFileSync("pdfinfo", [file], { encoding: "utf8" }), /Pages:\s+1/);
});

test.after(() => pool.end());
