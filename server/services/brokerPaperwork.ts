import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { documents } from "../../shared/schema";
import { BROKER_PUBLIC_ORIGIN } from "./brokerConfirmationPresentation";
import { escapeEmailHtml } from "../emailTemplate.js";

type Store = Pick<typeof db, "select">;
type PaperworkInvoice = { id: number; loadId: number | null; brokerConfirmationToken: string };
// Never expose carrier setup, identity, banking, or unrelated carrier documents.
const PAPERWORK_TYPES = ["invoice", "rate_confirmation", "bill_of_lading", "bol",
  "commercial_invoice", "pod", "proof_of_delivery", "lumper_receipt", "receipt", "other"] as const;

export async function brokerPaperwork(store: Store, invoice: PaperworkInvoice) {
  return store.select({
    id: documents.id, name: documents.originalName, filename: documents.filename,
    s3Key: documents.s3Key, type: documents.documentType,
  }).from(documents).where(and(
    or(eq(documents.invoiceId, invoice.id),
      invoice.loadId == null ? undefined :
        and(eq(documents.loadId, invoice.loadId), isNull(documents.invoiceId))),
    inArray(documents.documentType, [...PAPERWORK_TYPES]),
  )).orderBy(asc(documents.id));
}

export function brokerPaperworkBody(token: string, files: Array<{ id: number; name: string }>) {
  if (!files.length) return { html: "<p>No uploaded paperwork is currently available for this invoice.</p>",
    text: "\nNo uploaded paperwork is currently available for this invoice." };
  const links = files.map(file => ({
    name: file.name,
    url: `${BROKER_PUBLIC_ORIGIN}/api/broker-confirm/${encodeURIComponent(token)}/documents/${file.id}`,
  }));
  return {
    html: `<h2 style="font:700 18px Arial,Helvetica,sans-serif">Invoice paperwork</h2><ul>${links.map(file =>
      `<li><a href="${escapeEmailHtml(file.url)}" style="color:#176873">${escapeEmailHtml(file.name)}</a></li>`).join("")}</ul>`,
    text: `\nInvoice paperwork:\n${links.map(file => `${file.name}: ${file.url}`).join("\n")}`,
  };
}
