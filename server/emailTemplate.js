import fs from "node:fs";
import path from "node:path";

export const EMAIL_BRAND_MARKER = 'data-tpf-email="1"';
export const EMAIL_LOGO_CID = "tpf-white-emboss-logo";
export const escapeEmailHtml = value => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function emailDisplayName(value) {
  const name = String(value ?? "").trim();
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase())
    .replace(/\b(llc|inc|ltd|corp|usa)\b/gi, word => word.toUpperCase());
}

export function emailDetailsTable(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:20px 0;width:100%;font:16px Arial,Helvetica,sans-serif">${rows.map(([label, value]) =>
    `<tr><th scope="row" align="left" style="width:44%;padding:10px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:normal;vertical-align:top">${escapeEmailHtml(label)}</th><td style="padding:10px;border:1px solid #e5e7eb;overflow-wrap:anywhere"><strong>${escapeEmailHtml(value)}</strong></td></tr>`).join("")}</table>`;
}

export function paymentInstructions(config = process.env) {
  const routing = config.COMPANY_ROUTING?.trim();
  const account = config.COMPANY_ACCOUNT?.trim();
  const address = config.COMPANY_ADDRESS?.trim();
  if (!routing || !account || !address) return "";
  return `ACH to: Trucking Pros Financial — Routing: ${routing} · Account: ${account}\nOr mail check to: ${address}`;
}

export function configuredPaymentBody(text, config = process.env) {
  // Previously queued reminders can still contain the retired seeded defaults.
  // Replace that entire instruction block, not just one number.
  const body = String(text).replace(/^.*Routing:\s*021000021.*Account:\s*1234567890.*\r?\n(?:.*1234 Factoring Lane.*)?/gm,
    () => paymentInstructions(config));
  return paymentInstructions(config) ? body : body.replace(/^\s*Payment (?:instructions|details):?\s*$/gim, "");
}

export function hasUnsafePaymentInstructions(content) {
  const plain = String(content ?? "").replace(/<[^>]*>/g, "");
  return (/Routing:\s*021000021/i.test(plain) && /Account:\s*1234567890/i.test(plain)) || /1234 Factoring Lane/i.test(plain);
}

export function textToEmailBody(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const blocks = [];
  let rows = [];
  const flush = () => { if (rows.length) { blocks.push(emailDetailsTable(rows)); rows = []; } };
  for (const line of lines) {
    const row = line.match(/^\s*(?:[-•]\s*)?([^:\n]{1,70}):\s+(.+)$/);
    if (row && !/^(https?|email|phone)$/i.test(row[1].trim())) {
      rows.push([row[1].trim(), row[2].trim()]); continue;
    }
    flush();
    if (!line.trim()) continue;
    const greeting = line.match(/^(Hi|Hello|Dear)\s+(.+),$/);
    const content = greeting ? `${greeting[1]} ${emailDisplayName(greeting[2])},` : line;
    blocks.push(`<p style="margin:0 0 16px;line-height:1.6">${escapeEmailHtml(content)}</p>`);
  }
  flush();
  return blocks.join("\n");
}

function bodyFragment(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  // Trusted, flat action tables already contain mail-client-safe button paint.
  // Reformatting their cells makes the white primary label invisible.
  const actions = [];
  const protectedBody = body.replace(/<table\b[^>]*data-tpf-actions="1"[^>]*>[\s\S]*?<\/table>/gi,
    table => `TPF_ACTION_TABLE_${actions.push(table) - 1}_END`);
  return protectedBody.replace(/<!doctype[^>]*>|<\/?(?:html|body)\b[^>]*>|<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/>(Hi|Dear|Hello)\s+([^<]+),</g, (_match, greeting, name) => `>${greeting} ${emailDisplayName(name)},<`)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Remove the previous per-message brand bars/footer, retaining actual content.
    .replace(/<div\b[^>]*style="[^"]*background:\s*#(?:1e40af|2563eb)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<h[12]\b[^>]*>\s*Trucking Pros Financial\s*<\/h[12]>/gi, "")
    .replace(/<p\b[^>]*>[^<]*(?:Support@Truckingprosfinancial\.com|This is an automated message)[\s\S]*?<\/p>/gi, "")
    .replace(/(<div\b[^>]*?)\s+style="[^"]*"/gi, "$1")
    .replace(/(?:<p\b[^>]*>\s*<strong>(?:Invoice #|Load #|Amount):<\/strong>\s*[\s\S]*?<\/p>\s*)+/gi, group => {
      const rows = [...group.matchAll(/<strong>([^<]+):<\/strong>\s*([\s\S]*?)<\/p>/gi)]
        .map(([, label, value]) => [label, value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&")]);
      return emailDetailsTable(rows);
    })
    .replace(/<table\b[^>]*>/gi, '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:20px 0">')
    .replace(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, tag, value) =>
      `<${tag} align="left" style="padding:10px;border:1px solid #e5e7eb;vertical-align:top;overflow-wrap:anywhere;${tag === "th" ? "font-weight:normal;background:#f9fafb" : ""}">${tag === "td" ? `<strong>${value}</strong>` : value}</${tag}>`)
    .replace(/TPF_ACTION_TABLE_(\d+)_END/g, (_match, index) => actions[Number(index)]);
}

export function wrapEmail(subject, bodyHtml) {
  if (bodyHtml.includes(EMAIL_BRAND_MARKER)) return bodyHtml;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmailHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;color:#202124;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ${EMAIL_BRAND_MARKER} style="border-collapse:collapse">
<tr><td bgcolor="#27aab8" style="background:#27aab8;padding:20px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" align="center" style="max-width:600px;margin:auto"><tr>
<td width="64" style="vertical-align:middle"><img src="cid:${EMAIL_LOGO_CID}" width="48" height="47" alt="Trucking Pros Financial" style="display:block;width:48px;height:47px;border:0"></td>
<td style="color:#ffffff;font:700 21px Arial,Helvetica,sans-serif;vertical-align:middle">Trucking Pros Financial</td>
</tr></table></td></tr>
<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" align="center" style="max-width:600px;margin:auto"><tr><td style="font:16px Arial,Helvetica,sans-serif;line-height:1.6;color:#202124;overflow-wrap:anywhere">
<h1 style="font:700 22px Arial,Helvetica,sans-serif;line-height:1.35;margin:0 0 24px">${escapeEmailHtml(subject)}</h1>
${bodyFragment(bodyHtml)}
</td></tr></table></td></tr>
<tr><td bgcolor="#f5f5f5" style="background:#f5f5f5;padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" align="center" style="max-width:600px;margin:auto"><tr><td style="font:14px Arial,Helvetica,sans-serif;color:#555;line-height:1.6">
<strong>Trucking Pros Financial</strong><br>
<a href="mailto:dosh@truckingprosfinancial.com" style="color:#176873">dosh@truckingprosfinancial.com</a><br>
<a href="tel:+13854954962" style="color:#176873">385-495-4962</a>
<p style="font-size:12px;margin:12px 0 0">This is an automated message from Trucking Pros Financial.</p>
</td></tr></table></td></tr>
</table></body></html>`;
}

export function prepareBrandedEmail(params) {
  if (params.html?.includes(EMAIL_BRAND_MARKER) && params.attachments?.some(attachment => attachment.content_id === EMAIL_LOGO_CID)) return params;
  const candidates = ["client/public/images/tpf-logo-white.png", "dist/public/images/tpf-logo-white.png"];
  const logo = candidates.map(candidate => path.resolve(process.cwd(), candidate)).find(candidate => fs.existsSync(candidate));
  const attachments = (params.attachments ?? []).filter(attachment => attachment.content_id !== "factorflux-emboss-logo" && attachment.content_id !== EMAIL_LOGO_CID);
  if (logo) attachments.push({ content: fs.readFileSync(logo).toString("base64"), filename: "tpf-logo-white.png", type: "image/png", disposition: "inline", content_id: EMAIL_LOGO_CID });
  const brandText = value => String(value ?? "").replace(/\bFactorFlux\b(?!\.io\b)/g, "Trucking Pros Financial");
  let html = wrapEmail(brandText(params.subject), brandText(params.html || textToEmailBody(params.text)));
  if (!logo) html = html.replace(/<td width="64"[\s\S]*?<\/td>/, "");
  return { ...params, subject: brandText(params.subject), text: params.text === undefined ? undefined : brandText(params.text), html, attachments };
}
