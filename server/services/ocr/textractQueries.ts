import type { AnalyzeDocumentCommandOutput, Block } from "@aws-sdk/client-textract";
import type { OcrResult } from "./types";
import { fieldsFromText, parseAmount, parseServiceDate } from "./ocrFields";
import { normalizeCityState } from "../ocrBolMismatch";

export const INTAKE_QUERIES = [
  { Text: "What is the broker name?", Alias: "brokerName" },
  { Text: "What is the load number?", Alias: "loadNumber" },
  { Text: "What is the rate?", Alias: "rate" },
  { Text: "Pickup date?", Alias: "pickupDate" },
  { Text: "Delivery date?", Alias: "deliveryDate" },
  { Text: "Origin city/state?", Alias: "origin" },
  { Text: "Destination city/state?", Alias: "destination" },
  { Text: "Is there a receiver signature?", Alias: "receiverSignature" },
  { Text: "What is the BOL number?", Alias: "bolNumber" },
  // Company and section-specific questions avoid the agent-name and unlabeled
  // origin/destination-date ambiguities common in rate confirmations.
  { Text: "What is the name of the company at the top of the load confirmation?", Alias: "brokerCompanyName" },
  { Text: "What is the date in the Origin section?", Alias: "originDate" },
  { Text: "What is the date in the Destination section?", Alias: "destinationDate" },
  { Text: "What city and state are in the Origin section?", Alias: "originSection" },
  { Text: "What city and state are in the Destination section?", Alias: "destinationSection" },
];
export const BOL_QUERIES = [
  ...INTAKE_QUERIES.slice(0, 9),
  { Text: "What is the shipper's city and state?", Alias: "bolOrigin" },
  { Text: "What is the consignee's city and state?", Alias: "bolDestination" },
  { Text: "What is the shipper's city?", Alias: "bolOriginCity" },
  { Text: "What is the shipper's state?", Alias: "bolOriginState" },
  { Text: "What is the consignee's city?", Alias: "bolDestinationCity" },
  { Text: "What is the consignee's state?", Alias: "bolDestinationState" },
];

export function normalizeIntakeType(type: string): string {
  return ({ freight_invoice: "invoice", carrier_invoice: "invoice", bol_pod: "bol", bill_of_lading: "bol", proof_of_delivery: "pod" } as Record<string, string>)[type] ?? type;
}

export function queryDate(value: string | undefined): string | null {
  if (!value) return null;
  value = value.trim().replace(/^date\s*:\s*/i, "")
    .replace(/\s*(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\.?$/i, "");
  const direct = parseServiceDate(value.trim());
  if (direct) return direct;
  const numeric = value.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  // Day-first dates are accepted only when unambiguous.
  if (numeric && Number(numeric[1]) > 12) {
    return parseServiceDate(`${numeric[2]}/${numeric[1]}/${numeric[3]}`);
  }
  const named = value.trim().match(/^([A-Za-z]{3,9})[-\s]+(\d{1,2})[,\s-]+(\d{4})$/) ??
    value.trim().match(/^(\d{1,2})[-\s]+([A-Za-z]{3,9})[,\s-]+(\d{4})$/);
  if (!named) return null;
  const monthText = /^[A-Za-z]/.test(named[1]) ? named[1] : named[2];
  const day = /^\d/.test(named[1]) ? named[1] : named[2];
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    .indexOf(monthText.toLowerCase().slice(0, 3)) + 1;
  return month ? parseServiceDate(`${month}/${day}/${named[3]}`) : null;
}

function receiverInk(blocks: Block[]): Block | undefined {
  const labels = blocks.filter(block => block.BlockType === "LINE" &&
    /(?:receiver|consignee|received\s+by)/i.test(block.Text ?? ""));
  return blocks.find(block => block.BlockType === "SIGNATURE" && (block.Confidence ?? 0) >= 80 &&
    labels.some(label => {
      const ink = block.Geometry?.BoundingBox, heading = label.Geometry?.BoundingBox;
      return ink?.Top != null && ink.Left != null && heading?.Top != null && heading.Left != null &&
        ink.Top >= heading.Top - 0.03 && ink.Top <= heading.Top + 0.14 &&
        ink.Left + (ink.Width ?? 0) / 2 >= heading.Left - 0.1 &&
        ink.Left + (ink.Width ?? 0) / 2 <= heading.Left + (heading.Width ?? 0) + 0.17;
    }));
}

export function decodeQueries(response: AnalyzeDocumentCommandOutput, docType = "rate_confirmation"): OcrResult {
  const blocks = response.Blocks ?? [];
  const lines = blocks.filter(block => block.BlockType === "LINE");
  const text = lines.map(line => line.Text ?? "").join("\n");
  const lineConfidence = lines.flatMap(line => line.Confidence == null ? [] : [line.Confidence / 100]);
  const answers: Record<string, string> = {}, confidence: Record<string, number> = {};
  for (const query of blocks.filter(block => block.BlockType === "QUERY")) {
    const alias = query.Query?.Alias;
    if (!alias) continue;
    const ids = query.Relationships?.filter(rel => rel.Type === "ANSWER").flatMap(rel => rel.Ids ?? []) ?? [];
    const answer = blocks.filter(block => ids.includes(block.Id ?? "") && block.BlockType === "QUERY_RESULT")
      .sort((a, b) => (b.Confidence ?? 0) - (a.Confidence ?? 0))[0];
    if (answer?.Text?.trim()) {
      answers[alias] = answer.Text.trim();
      confidence[alias] = (answer.Confidence ?? 0) / 100;
    }
  }
  const labeled = fieldsFromText(text);
  if (docType === "rate_confirmation") for (const [field, qualified] of [["brokerName", "brokerCompanyName"], ["pickupDate", "originDate"],
    ["deliveryDate", "destinationDate"], ["origin", "originSection"], ["destination", "destinationSection"]]) {
    if (answers[qualified]) { answers[field] = answers[qualified]; confidence[field] = confidence[qualified]; }
  }
  const isBol = ["bol", "pod"].includes(normalizeIntakeType(docType));
  if (isBol) for (const [field, qualified] of [["origin", "bolOrigin"], ["destination", "bolDestination"]]) {
    if (answers[qualified]) { answers[field] = answers[qualified]; confidence[field] = confidence[qualified]; }
    if (answers[`${qualified}City`] && answers[`${qualified}State`]) {
      const city = answers[`${qualified}City`];
      const combined = normalizeCityState(city) ? city : `${city}, ${answers[`${qualified}State`]}`;
      if (normalizeCityState(combined)) {
        answers[field] = combined;
        confidence[field] = Math.min(confidence[`${qualified}City`] ?? 0, confidence[`${qualified}State`] ?? 0);
      }
    }
  }
  const signature = receiverInk(blocks);
  const positiveAnswer = /^(?:yes|true|signed|present|detected)\b/i.test(answers.receiverSignature ?? "") &&
    (confidence.receiverSignature ?? 0) >= 0.8;
  const cleanId = (value: string | undefined) => {
    const token = value?.replace(/^[*#]+/, "").split(/\s/)[0]?.replace(/\*+$/, "");
    return token && /^[A-Z0-9-]+$/i.test(token) ? token : null;
  };
  const labeledLoad = labeled.loadNumber && /^load\s*(?:#|number\b|id\b|no\.?\b)/i.test(labeled.loadNumberSourceLabel ?? "");
  if (labeledLoad) {
    const line = lines.find(line => /\bload\b/i.test(line.Text ?? "") && line.Text?.includes(labeled.loadNumber!));
    if (line?.Confidence != null) confidence.loadNumber = line.Confidence / 100;
  }
  // A BOL number is not a load reference. Only a visibly labeled load/shipment
  // reference may drive BOL_MISMATCH, never an unsupported query answer.
  const shipment = isBol ? text.match(/\b(shipment\s*(?:id|number|no\.?|reference|ref\.?|#))\s*[:#]?\s*\**([A-Z0-9][A-Z0-9-]*)(?=[*\s,;.]|$)/i) : null;
  const shipmentValue = shipment && !/^(?:LOAD|NUMBER|ID|SHIPMENT|SHIPPING|DOC|DOCUMENT|ORIGIN|DESTINATION|DATE|SIGNATURE)$/i.test(shipment[2])
    ? shipment[2] : null;
  const visibleReference = labeledLoad ? labeled.loadNumber : shipmentValue;
  const visibleLabel = labeledLoad ? labeled.loadNumberSourceLabel : shipmentValue ? shipment![1] : null;
  if (isBol && visibleReference) {
    const line = lines.find(line => line.Text?.includes(visibleReference));
    if (line?.Confidence != null) confidence.loadNumber = line.Confidence / 100;
  }
  const fields = {
    ...labeled, invoiceNumber: null, invoiceDate: null, brokerName: answers.brokerName ?? null,
    loadNumber: isBol ? visibleReference : labeledLoad ? labeled.loadNumber : cleanId(answers.loadNumber) ?? labeled.loadNumber,
    loadNumberSourceLabel: isBol ? visibleLabel : labeledLoad ? labeled.loadNumberSourceLabel : answers.loadNumber ? "Textract load-number query" : labeled.loadNumberSourceLabel,
    amount: parseAmount(answers.rate), rate: parseAmount(answers.rate),
    serviceDate: null, pickupDate: queryDate(answers.pickupDate), deliveryDate: queryDate(answers.deliveryDate),
    origin: answers.origin ?? null, destination: answers.destination ?? null,
    bolNumber: cleanId(answers.bolNumber) ?? labeled.bolNumber,
    receiverSignature: Boolean(signature || positiveAnswer),
    fieldConfidences: { ...confidence,
      amount: confidence.rate ?? 0,
      receiverSignature: signature ? (signature.Confidence ?? 0) / 100 : confidence.receiverSignature ?? 0 },
  };
  return { text, fields, confidence: lineConfidence.length
    ? lineConfidence.reduce((sum, value) => sum + value, 0) / lineConfidence.length : 0,
  raw: { response, answers, queryConfidences: confidence,
    signatureEvidence: signature?.Id ?? (positiveAnswer ? "query_answer" : null) } };
}
