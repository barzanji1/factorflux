import fs from "node:fs/promises";
import { sendEmailTracked } from "../server/emailService";
import { prepareBrandedEmail, textToEmailBody, emailDetailsTable, escapeEmailHtml } from "../server/emailTemplate.js";
import { pool } from "../server/db";

const kinds = [
  ["carrier_advance", "Carrier advance notification", "Your advance is on its way."],
  ["broker_followup", "Broker payment follow-up", "Please confirm payment timing for this invoice."],
  ["broker_confirmation", "Broker confirmation request", "Please confirm receipt of the invoice. This is a rendering test; no receipt will be recorded."],
  ["funding_receipt", "Funding receipt", "Your funding receipt details appear below. This is a rendering test, not an actual funding receipt."],
  ["doc_request", "Document request", "Please send the rate confirmation and signed BOL/POD for this load."],
  ["chargeback_notice", "Chargeback notice", "This is a sample chargeback notice. No chargeback has been created."],
  ["missing_docs", "Missing documents alert", "The signed BOL/POD is missing. This is sample paperwork only."],
] as const;

async function main() {
  const shouldSend = process.argv.includes("--send");
  await fs.mkdir("generated-artifacts/email-branding", { recursive: true });
  const previews: Array<[string, string]> = [];
  for (const [kind, title, introduction] of kinds) {
    const subject = `[TEST — no action required] ${title} — TEST-1001`;
    const text = `Hi TEST PILOT CARRIER LLC,\n\n${introduction}\n\nInvoice #: TEST-1001\nLoad #: 150611\nAmount: $125.50\n\nNo customer or invoice records have been changed.`;
    const html = kind === "broker_confirmation"
      ? `<p>${escapeEmailHtml(introduction)}</p>${emailDetailsTable([["Invoice #", "TEST-1001"], ["Load #", "150611"], ["Amount", "$125.50"]])}<p><a href="#test-only" style="display:inline-block;padding:12px;background:#27aab8;color:white;text-decoration:none">Confirm Receipt — Test Only</a></p>`
      : textToEmailBody(text);
    const prepared = prepareBrandedEmail({ to: "dosh@truckingprosfinancial.com", subject, text, html });
    const logo = prepared.attachments?.find(attachment => attachment.content_id === "tpf-white-emboss-logo");
    const preview = prepared.html!.replace("cid:tpf-white-emboss-logo", `data:image/png;base64,${logo!.content}`);
    previews.push([title, preview]);
    await fs.writeFile(`generated-artifacts/email-branding/${kind}.html`, preview);
    if (shouldSend) {
      const result = await sendEmailTracked({
        to: "dosh@truckingprosfinancial.com", subject, text, html,
        emailLog: { templateName: `branding_test_${kind}`, sentByUserId: null },
        idempotencyKey: `email-branding-test/${kind}/2026-10-13`,
      });
      console.log(JSON.stringify({ kind, success: result.success, messageId: result.messageId ?? null }));
      if (!result.success) throw new Error(`Test delivery failed for ${kind}; inspect Email Log before retrying.`);
    }
  }
  await fs.writeFile("generated-artifacts/email-branding/index.html",
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email previews</title></head><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif"><h1 style="padding:16px">Trucking Pros Financial — email samples</h1><p style="padding:16px">Test content only. These previews do not confirm Gmail delivery or rendering.</p>${previews.map(([title, html]) => `<h2 style="padding:16px">${escapeEmailHtml(title)}</h2><iframe title="${escapeEmailHtml(title)}" srcdoc="${escapeEmailHtml(html)}" style="display:block;width:100%;height:900px;border:0"></iframe>`).join("")}</body></html>`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
