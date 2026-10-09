import type { OcrFields } from "./types";
import { extractInvoiceNumber, extractLoadNumber, extractBolNumber } from "../documentFieldDetectors";

export function parseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/[$,\s]/g, "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

export function parseServiceDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const iso = match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function fieldsFromText(text: string): OcrFields {
  const load = extractLoadNumber(text);
  return {
    invoiceNumber: extractInvoiceNumber(text)?.normalized ?? null,
    loadNumber: load?.normalized ?? null,
    loadNumberSourceLabel: load?.sourceLabel ?? null,
    amount: parseAmount(text.match(/\b(?:grand\s+total|total\s+(?:due|amount)|invoice\s+total|total|rate)\s*:?\s*\$?([\d,]+\.\d{2})\b/i)?.[1]),
    brokerName: text.match(/(?:^|\n)\s*(?:broker(?:\s+name)?|bill\s+to)\s*:?[ \t]*\n?[ \t]*([^\n]+)/i)?.[1]?.trim() ?? null,
    serviceDate: parseServiceDate(text.match(/\b(?:service|delivery|pickup)\s+date\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})/i)?.[1]),
    invoiceDate: parseServiceDate(text.match(/\binvoice\s+date\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})/i)?.[1]),
    bolNumber: extractBolNumber(text)?.normalized ?? null,
  };
}

export function mergeFields(fields: OcrFields[]): OcrFields {
  const result = fieldsFromText("");
  for (const page of fields) {
    for (const key of Object.keys(result) as (keyof OcrFields)[]) {
      if (key === "loadNumberSourceLabel") continue;
      if (result[key] == null && page[key] != null) {
        Object.assign(result, { [key]: page[key] });
        if (key === "loadNumber") result.loadNumberSourceLabel = page.loadNumberSourceLabel ?? null;
      }
    }
  }
  // A fallback reference on page one must not beat an explicit Load on page two.
  const explicitLoad = fields.find(page => page.loadNumber && /^load\b/i.test(page.loadNumberSourceLabel ?? ""));
  if (explicitLoad) {
    result.loadNumber = explicitLoad.loadNumber;
    result.loadNumberSourceLabel = explicitLoad.loadNumberSourceLabel;
  }
  return result;
}
