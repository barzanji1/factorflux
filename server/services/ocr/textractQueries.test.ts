import test from "node:test";
import assert from "node:assert/strict";
import { AnalyzeDocumentCommand, AnalyzeExpenseCommand, DetectDocumentTextCommand, type Block } from "@aws-sdk/client-textract";
import { BOL_QUERIES, decodeQueries, INTAKE_QUERIES, queryDate } from "./textractQueries";
import { TextractProvider } from "./textractProvider";
const answer = (alias: string, text: string, confidence = 95): Block[] => [
  { BlockType: "QUERY", Id: alias, Query: { Alias: alias }, Relationships: [{ Type: "ANSWER", Ids: [`${alias}-a`] }] },
  { BlockType: "QUERY_RESULT", Id: `${alias}-a`, Text: text, Confidence: confidence },
];
test("preclassified lumper receipt uses text OCR without calling Claude or BOL queries", async () => {
  const calls: unknown[] = [];
  const provider = new TextractProvider({ send: async (command: unknown) => {
    calls.push(command);
    return { Blocks: [{ BlockType: "LINE", Text: "Lumper Receipt 0556271 Paid $250", Confidence: 98 }] };
  } } as any, async () => [Buffer.from("page")], async () => {
    throw new Error("Classification must be skipped for a preset type");
  });
  const result = await provider.extract(Buffer.from("file"), "application/pdf", "lumper_receipt");
  assert.equal((result.raw as any).docType, "lumper_receipt");
  assert.equal((result.raw as any).operation, "DetectDocumentText");
  assert.equal(calls.length, 1);
  assert(calls[0] instanceof DetectDocumentTextCommand);
  assert.match(result.text, /0556271/);
});
test("query fields retain answer confidence, section dates and company name beat ambiguous questions", () => {
  const result = decodeQueries({ Blocks: [
    { BlockType: "LINE", Text: "Load #150611", Confidence: 98 },
    ...answer("brokerName", "Sam Wilson"), ...answer("brokerCompanyName", "TransJet Cargo LLC", 99),
    ...answer("loadNumber", "150611"), ...answer("rate", "$250.00"),
    ...answer("originDate", "09/23/2026"), ...answer("destinationDate", "09/24/2026"),
    ...answer("originSection", "Stoughton, MA"), ...answer("destinationSection", "Natick, MA"),
  ] });
  assert.equal(result.fields.brokerName, "TransJet Cargo LLC");
  assert.equal(result.fields.fieldConfidences?.brokerName, .99);
  assert.equal(result.fields.pickupDate, "2026-09-23");
  assert.equal(result.fields.deliveryDate, "2026-09-24");
  assert.equal(result.fields.origin, "Stoughton, MA");
  assert.equal(result.fields.amount, 250);
  assert.equal(result.fields.invoiceDate, null);
  assert.equal(result.fields.receiverSignature, false);
  assert(INTAKE_QUERIES.length <= 15);
});
test("receiver signature requires positive answer or located ink, not a printed signature label", () => {
  const label: Block = { BlockType: "LINE", Text: "CONSIGNEE", Geometry: { BoundingBox: { Left: .7, Top: .3, Width: .1 } } };
  assert.equal(decodeQueries({ Blocks: [label] }).fields.receiverSignature, false);
  assert.equal(decodeQueries({ Blocks: [...answer("receiverSignature", "No")] }).fields.receiverSignature, false);
  assert.equal(decodeQueries({ Blocks: [...answer("receiverSignature", "Yes", 90)] }).fields.receiverSignature, true);
  const ink: Block = { BlockType: "SIGNATURE", Id: "ink", Confidence: 94, Geometry: { BoundingBox: { Left: .68, Top: .35, Width: .2 } } };
  assert.equal(decodeQueries({ Blocks: [label, ink] }).fields.receiverSignature, true);
  assert.equal(decodeQueries({ Blocks: [label, { ...ink, Geometry: { BoundingBox: { Left: .2, Top: .35, Width: .1 } } }] }).fields.receiverSignature, false);
});
test("BOL retains visibly labeled shipment ID and shipper/consignee route, not unsupported query load guesses", () => {
  const result = decodeQueries({ Blocks: [
    { BlockType: "LINE", Text: "Shipment ID *202615480*", Confidence: 98 },
    ...answer("loadNumber", "WRONG-GUESS"), ...answer("bolOrigin", "A full shipper address", 35),
    ...answer("bolDestination", "A full consignee address", 23),
    ...answer("bolOriginCity", "Schenectady"), ...answer("bolOriginState", "NY"),
    ...answer("bolDestinationCity", "Franklin"), ...answer("bolDestinationState", "GA", 90),
  ] }, "bol");
  assert.equal(result.fields.loadNumber, "202615480");
  assert.equal(result.fields.loadNumberSourceLabel, "Shipment ID");
  assert.equal(result.fields.fieldConfidences?.loadNumber, .98);
  assert.equal(result.fields.origin, "Schenectady, NY");
  assert.equal(result.fields.destination, "Franklin, GA");
  assert.equal(result.fields.fieldConfidences?.destination, .9);
  const unknown = decodeQueries({ Blocks: [...answer("loadNumber", "150611"), ...answer("bolNumber", "12345")] }, "bol");
  assert.equal(unknown.fields.loadNumber, null);
  assert.equal(unknown.fields.bolNumber, "12345");
  assert(BOL_QUERIES.length <= 15);
});
test("named and unambiguous day-first dates parse, invalid dates stay null", () => {
  assert.equal(queryDate("SEP-25-2026"), "2026-09-25");
  assert.equal(queryDate("09/23/2026 Wednesday"), "2026-09-23");
  assert.equal(queryDate("09/23/2026Wednesday"), "2026-09-23");
  assert.equal(queryDate("23-09-2026"), "2026-09-23");
  assert.equal(queryDate("31 February 2026"), null);
  assert.equal(queryDate("yesterday"), null);
});
for (const [classified, expected] of [["freight_invoice", AnalyzeExpenseCommand], ["carrier_invoice", AnalyzeExpenseCommand], ["rate_confirmation", AnalyzeDocumentCommand], ["bill_of_lading", AnalyzeDocumentCommand], ["bol_pod", AnalyzeDocumentCommand]]) {
  test(`automatic ${classified} classification routes to ${expected.name}`, async () => {
    const calls: unknown[] = [];
    const provider = new TextractProvider({ send: async (command: unknown) => {
      calls.push(command);
      if (command instanceof AnalyzeExpenseCommand) return { ExpenseDocuments: [{ Blocks: [{ BlockType: "LINE", Text: "Invoice #9", Confidence: 98 }] }] };
      return { Blocks: [{ BlockType: "LINE", Text: "Load #150611", Confidence: 98 }] };
    } } as any, async () => [Buffer.from("page")], async () => ({
      docType: classified, confidence: .99, signals: [], reasoning: "Fixture", allScores: {}, model: "claude-haiku-4-5", source: "ai",
    }));
    const result = await provider.extract(Buffer.from("file"), "application/pdf", "auto");
    assert(calls[0] instanceof DetectDocumentTextCommand);
    assert(calls[1] instanceof expected);
    assert.equal((result.raw as any).classification.model, "claude-haiku-4-5");
  });
}
test("automatic classifier receives only first-page text, not later-page instructions", async () => {
  let page = 0, input = "";
  const provider = new TextractProvider({ send: async (command: unknown) => {
    const text = command instanceof DetectDocumentTextCommand ? (++page === 1 ? "First-page rate con" : "Later-page invoice text") : "Rate con";
    return { Blocks: [{ BlockType: "LINE", Text: text, Confidence: 98 }] };
  } } as any, async () => [Buffer.from("p1"), Buffer.from("p2")], async text => {
    input = text;
    return { docType: "rate_confirmation", confidence: .99, signals: [], reasoning: "", allScores: {}, model: "claude-haiku-4-5", source: "ai" };
  });
  await provider.extract(Buffer.from("file"), "application/pdf", "auto");
  assert.equal(input, "First-page rate con");
});
test("classifier failure propagates, never routes guessed documents to another operation", async () => {
  const calls: unknown[] = [];
  const provider = new TextractProvider({ send: async (command: unknown) => {
    calls.push(command); return { Blocks: [{ BlockType: "LINE", Text: "A document", Confidence: 98 }] };
  } } as any, async () => [Buffer.from("page")], async () => { throw new Error("Classifier exhausted"); });
  await assert.rejects(provider.extract(Buffer.from("file"), "application/pdf", "auto"), /Classifier exhausted/);
  assert.equal(calls.length, 1);
});
