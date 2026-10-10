import type { InvoicePreflightAlert } from "./invoicePreflight";
import { normalizeIntakeType } from "./ocr/textractQueries";
import { bolMismatchReasons } from "./ocrBolMismatch";

export type IntakeDocument = {
  documentId: number; filename: string; docType: string; status: string; error?: string | null;
  fields: Record<string, string>; confidence: number; fieldConfidences: Record<string, number>;
  contentHash?: string | null; invoiceId?: number | null; classification?: unknown;
};
export type IntakeSource = { documentId: number; filename: string; docType: string; confidence: number };
export class IntakeError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function intakeTolerance(value = process.env.OCR_RATE_TOLERANCE ?? "0"): number {
  const result = Number(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(result)) {
    throw new IntakeError("OCR_RATE_TOLERANCE must be a nonnegative dollar amount with at most two decimal places", 500);
  }
  return result;
}

export function mapIntakeDocuments(documents: IntakeDocument[], tolerance = intakeTolerance()) {
  const completed = documents.filter(doc => doc.status === "completed");
  const select = (type: string) => {
    const found = completed.filter(doc => type === "bol"
      ? ["bol", "pod"].includes(normalizeIntakeType(doc.docType)) : normalizeIntakeType(doc.docType) === type);
    if (found.length > 1) throw new IntakeError(`Multiple ${type} documents detected. Keep one document per type and retry.`, 409);
    return found[0];
  };
  const rateCon = select("rate_confirmation"), invoice = select("invoice"), bol = select("bol");
  const fields: Record<string, string> = {}, sources: Record<string, IntakeSource> = {};
  const put = (key: string, doc: IntakeDocument | undefined, sourceKey = key) => {
    const value = doc?.fields[sourceKey];
    if (!doc || value == null || value === "") return;
    fields[key] = value;
    sources[key] = { documentId: doc.documentId, filename: doc.filename,
      docType: normalizeIntakeType(doc.docType), confidence: doc.fieldConfidences[sourceKey] ?? doc.confidence };
  };
  for (const key of ["broker_name", "load_number", "load_number_label", "rate", "pickup_date", "delivery_date", "origin", "destination"]) put(key, rateCon);
  for (const key of ["invoice_number", "invoice_date", "amount"]) put(key, invoice);
  for (const key of ["delivery_date", "bol_number", "pod_signature"]) put(key, bol);
  // Single invoice intake remains usable, but a rate con never silently loses priority.
  if (!rateCon) for (const key of ["broker_name", "load_number", "load_number_label"]) put(key, invoice);
  const alerts: InvoicePreflightAlert[] = [];
  const alert = (code: string, severity: "ack" | "info", title: string, message: string) =>
    alerts.push({ code, severity, title, message });
  const number = (value: string | undefined) => value != null && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
  const rate = number(rateCon?.fields.rate), amount = number(invoice?.fields.amount);
  if (rate != null && amount != null && Math.abs(Math.round(rate * 100) - Math.round(amount * 100)) > Math.round(tolerance * 100)) {
    alert("RATE_MISMATCH", "ack", "Billed amount differs from rate",
      `${invoice!.filename}: $${amount.toFixed(2)}; ${rateCon!.filename}: $${rate.toFixed(2)} (tolerance $${tolerance.toFixed(2)}).`);
  }
  const rateLoad = rateCon?.fields.load_number?.trim(), invoiceLoad = invoice?.fields.load_number?.trim();
  if (rateLoad && invoiceLoad && rateLoad.toUpperCase() !== invoiceLoad.toUpperCase()) {
    alert("LOAD_MISMATCH", "ack", "Load numbers differ",
      `${rateCon!.filename}: ${rateLoad}; ${invoice!.filename}: ${invoiceLoad}.`);
  }
  if (rateCon && bol) {
    const reasons = bolMismatchReasons(rateCon.fields, bol.fields);
    if (reasons.length) alert("BOL_MISMATCH", "ack", "BOL does not match rate confirmation",
      `${rateCon.filename} vs ${bol.filename}: ${reasons.join("; ")}. Verify the paperwork and acknowledge before creating the invoice.`);
  }
  const delivery = bol?.fields.delivery_date, invoiceDate = invoice?.fields.invoice_date;
  if (delivery && invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(delivery) && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) && delivery > invoiceDate) {
    alert("DELIVERY_AFTER_INVOICE", "ack", "Delivery is after invoice date",
      `${bol!.filename}: delivery ${delivery}; ${invoice!.filename}: invoice ${invoiceDate}.`);
  }
  if (bol && bol.fields.pod_signature !== "true") {
    alert("NO_SIGNATURE", "info", "Receiver signature not detected",
      `No receiver signature was detected in ${bol.filename}. Review the BOL/POD.`);
  }
  return { fields, sources, alerts, tolerance,
    missingTypes: [["rate_confirmation", rateCon], ["invoice", invoice], ["bol", bol]]
      .filter(([, doc]) => !doc).map(([type]) => String(type)) };
}
