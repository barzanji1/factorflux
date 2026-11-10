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

export function brokerReceiptActions(token: string): string {
  const links = brokerReceiptLinks(token);
  // Inline styles and presentation tables work in mail clients without CSS
  // support. Separate full-width rows remain comfortable tap targets on phones.
  return `<table data-tpf-actions="1" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:24px 0">
<tr><td align="center" bgcolor="#27aab8" style="background:#27aab8;border-radius:12px">
<a href="${escapeEmailHtml(links.confirm)}" style="display:block;padding:15px 20px;min-height:20px;line-height:24px;font:700 16px Arial,Helvetica,sans-serif;color:#ffffff;text-align:center;text-decoration:none">Confirm Receipt</a></td></tr>
<tr><td height="12" style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td align="center" bgcolor="#f5f5f5" style="background:#f5f5f5;border-radius:12px">
<a href="${escapeEmailHtml(links.dispute)}" style="display:block;padding:15px 20px;min-height:20px;line-height:24px;font:700 16px Arial,Helvetica,sans-serif;color:#176873;text-align:center;text-decoration:none">Dispute</a></td></tr></table>
<p style="font:14px Arial,Helvetica,sans-serif;color:#666;line-height:1.6">Opening a link does not confirm receipt. Use the button on the page to submit your response.</p>`;
}
