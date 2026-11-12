import { test } from "node:test";
import assert from "node:assert/strict";
import { brokerReceiptActions, brokerReceiptLinks } from "./brokerConfirmationPresentation";
import { prepareBrandedEmail, wrapEmail, EMAIL_LOGO_CID } from "../emailTemplate.js";

test("broker actions always use verified .io links and large mobile-friendly buttons", () => {
  const token = "00000000-0000-4000-8000-000000000001";
  const links = brokerReceiptLinks(token);
  assert.equal(links.confirm, `https://factorflux.io/api/broker-confirm/${token}`);
  assert.equal(links.dispute, `https://factorflux.io/api/broker-dispute/${token}`);
  const html = brokerReceiptActions(token);
  assert.match(html, /display:block;padding:15px 20px/);
  assert.match(html, /Confirm Receipt/);
  assert.match(html, /Dispute/);
  assert.ok(!html.includes("factorflux.co"));
  assert.ok(!brokerReceiptActions('"><script>').includes("<script>"));
});

test("receipt and reminder bodies keep one TPF wrapper, inline logo and styled actions", () => {
  for (const subject of ["Please confirm invoice receipt", "Receipt reminder 3", "Receipt reminder 7", "Receipt reminder 14"]) {
    const html = wrapEmail(subject, brokerReceiptActions("fixture-token"));
    const prepared = prepareBrandedEmail({ to: "fixture@example.test", subject, html });
    assert.equal((prepared.html.match(/data-tpf-email="1"/g) ?? []).length, 1);
    assert.match(prepared.html, /bgcolor="#27aab8"/);
    assert.match(prepared.html, /bgcolor="#ffffff"/);
    assert.match(prepared.html, /bgcolor="#f5f5f5"/);
    // Assert the ACTION cell, not the unrelated teal brand header.
    assert.match(prepared.html, /<td align="center" bgcolor="#27aab8"[^>]*>\s*<a href="https:\/\/factorflux\.io\/api\/broker-confirm\/fixture-token"[^>]*color:#ffffff[^>]*>Confirm Receipt<\/a>/);
    assert.match(prepared.html, /<td align="center" bgcolor="#f5f5f5"[^>]*>\s*<a href="https:\/\/factorflux\.io\/api\/broker-dispute\/fixture-token"[^>]*>Dispute<\/a>/);
    assert.match(prepared.html, /Trucking Pros Financial/);
    assert.ok(!prepared.html.includes("FactorFlux"));
    assert.ok(prepared.attachments?.some(attachment => attachment.content_id === EMAIL_LOGO_CID));
  }
});
