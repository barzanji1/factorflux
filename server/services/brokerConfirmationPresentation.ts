import { escapeEmailHtml } from "../emailTemplate.js";

// Both domains are deployed, but broker-facing links must use the .io domain.
export const BROKER_PUBLIC_ORIGIN = "https://factorflux.io";

export function brokerReceiptLinks(token: string) {
  const safeToken = encodeURIComponent(token);
  return {
    confirm: `${BROKER_PUBLIC_ORIGIN}/api/broker-confirm/${safeToken}`,
    dispute: `${BROKER_PUBLIC_ORIGIN}/api/broker-dispute/${safeToken}`,
  };
}

export const BROKER_PAPERWORK_TYPES = [
  "invoice", "rate_confirmation", "bill_of_lading", "bol", "commercial_invoice",
  "pod", "proof_of_delivery", "lumper_receipt", "receipt", "other",
] as const;

export function brokerPaperworkLinks(token: string, documents: Array<{ id: number; originalName: string; documentType: string }>) {
  return documents.map(document => ({
    label: `${document.documentType.replaceAll("_", " ")} — ${document.originalName}`,
    url: `${BROKER_PUBLIC_ORIGIN}/api/broker-confirm/${encodeURIComponent(token)}/documents/${document.id}/download`,
  }));
}

export function brokerPaperworkHtml(links: Array<{ label: string; url: string }>): string {
  return links.length ? `<p><strong>Review invoice documents</strong></p><ul>${links.map(link =>
    `<li><a href="${escapeEmailHtml(link.url)}" style="color:#176873;text-decoration:underline">${escapeEmailHtml(link.label)}</a></li>`).join("")}</ul>` : "";
}

export function brokerPaperworkText(links: Array<{ label: string; url: string }>): string {
  return links.length ? `\nReview invoice documents:\n${links.map(link => `${link.label}: ${link.url}`).join("\n")}` : "";
}

export function brokerReceiptActions(token: string): string {
  const links = brokerReceiptLinks(token);
  // Inline styles and presentation tables work in mail clients without CSS
  // support. Separate full-width rows remain comfortable tap targets on phones.
  return `<table role="presentation" data-tpf-actions="broker-receipt" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:24px 0">
<tr><td align="center" bgcolor="#27aab8" style="background:#27aab8;border-radius:12px">
<a href="${escapeEmailHtml(links.confirm)}" style="display:block;padding:15px 20px;min-height:20px;line-height:24px;font:700 16px Arial,Helvetica,sans-serif;color:#ffffff;text-align:center;text-decoration:none">Confirm Receipt</a></td></tr>
<tr><td height="12" style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td align="center" bgcolor="#f5f5f5" style="background:#f5f5f5;border-radius:12px">
<a href="${escapeEmailHtml(links.dispute)}" style="display:block;padding:15px 20px;min-height:20px;line-height:24px;font:700 16px Arial,Helvetica,sans-serif;color:#176873;text-align:center;text-decoration:none">Dispute</a></td></tr></table>
<p style="font:14px Arial,Helvetica,sans-serif;color:#666;line-height:1.6">Opening a link does not confirm receipt. Use the button on the page to submit your response.</p>`;
}
