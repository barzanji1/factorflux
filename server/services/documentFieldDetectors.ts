export type FieldResult = { value: string; normalized: string; confidence: number } | null;

const LABEL_WORDS = new Set([
  "INVOICE", "INV", "LOAD", "ORDER", "PRO", "REF", "REFERENCE", "BOL",
  "CONFIRMATION", "CONF", "PO", "BILL", "LADING", "NUMBER", "NUM", "NO", "ID",
  "DATE", "TOTAL", "AMOUNT", "BROKER", "CARRIER", "SHIPPER", "RATE", "DUE",
]);

function identifier(text: string, labels: string[], confidence: number): FieldResult {
  // Match the label independently of its value. Otherwise a missing value
  // lets a regex backtrack and reinterpret "Number" as the identifier.
  const label = new RegExp(
    `\\b(?:${labels.join("|")})\\b(?=[\\s:#]|$)(?:[ \\t]+(?:number|num|no|id)\\b\\.?)?[ \\t]*(?:[:#][ \\t]*)?`,
    "gi",
  );
  for (const match of text.matchAll(label)) {
    const tail = text.slice(match.index! + match[0].length);
    const token = tail.match(/^\s*([A-Z0-9-]+)(?=\s|$)/i)?.[1];
    if (!token || !/[A-Z0-9]/i.test(token) || LABEL_WORDS.has(token.toUpperCase())) continue;
    return { value: token, normalized: token.toUpperCase(), confidence };
  }
  return null;
}

export function extractInvoiceNumber(text: string): FieldResult {
  return identifier(text, ["invoice", "inv"], 0.8);
}

export function extractLoadNumber(text: string): FieldResult {
  return identifier(text, ["load", "order"], 0.82);
}

export function extractReferenceNumber(text: string): FieldResult {
  // Shipment/reference identifiers are not silently relabeled as load IDs.
  return identifier(text, ["reference", "ref", "confirmation", "conf", "po", "pro", "bol"], 0.72);
}

export function extractBolNumber(text: string): FieldResult {
  return identifier(text, ["b/l", "bol", "bill[ \\t]+of[ \\t]+lading"], 0.85);
}
