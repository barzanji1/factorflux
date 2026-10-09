import test from "node:test";
import assert from "node:assert/strict";
import { AnalyzeDocumentCommand, AnalyzeExpenseCommand, DetectDocumentTextCommand, type Block } from "@aws-sdk/client-textract";
import { decodeQueries, INTAKE_QUERIES, queryDate } from "./textractQueries";
import { TextractProvider } from "./textractProvider";
const answer = (alias: string, text: string, confidence = 95): Block[] => [
  { BlockType: "QUERY", Id: alias, Query: { Alias: alias }, Relationships: [{ Type: "ANSWER", Ids: [`${alias}-a`] }] },
  { BlockType: "QUERY_RESULT", Id: `${alias}-a`, Text: text, Confidence: confidence },
];
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
test("named and unambiguous day-first dates parse, invalid dates stay null", () => {
  assert.equal(queryDate("SEP-25-2026"), "2026-09-25");
  assert.equal(queryDate("09/23/2026 Wednesday"), "2026-09-23");
  assert.equal(queryDate("09/23/2026Wednesday"), "2026-09-23");
  assert.equal(queryDate("23-09-2026"), "2026-09-23");
  assert.equal(queryDate("31 February 2026"), null);
  assert.equal(queryDate("yesterday"), null);
});
for (const [classified, expected] of [["freight_invoice", AnalyzeExpenseCommand], ["rate_confirmation", AnalyzeDocumentCommand], ["bill_of_lading", AnalyzeDocumentCommand]]) {
  test(`automatic ${classified} classification routes to ${expected.name}`, async () => {
    const calls: unknown[] = [];
    const provider = new TextractProvider({ send: async (command: unknown) => {
      calls.push(command);
      if (command instanceof AnalyzeExpenseCommand) return { ExpenseDocuments: [{ Blocks: [{ BlockType: "LINE", Text: "Invoice #9", Confidence: 98 }] }] };
      return { Blocks: [{ BlockType: "LINE", Text: "Load #150611", Confidence: 98 }] };
    } } as any, async () => [Buffer.from("page")], async () => ({
      docType: classified, confidence: .99, signals: [], reasoning: "Fixture", allScores: {}, model: "gpt-4o-mini", source: "ai",
    }));
    const result = await provider.extract(Buffer.from("file"), "application/pdf", "auto");
    assert(calls[0] instanceof DetectDocumentTextCommand);
    assert(calls[1] instanceof expected);
    assert.equal((result.raw as any).classification.model, "gpt-4o-mini");
  });
}
test("classifier failure propagates, never routes guessed documents to another operation", async () => {
  const calls: unknown[] = [];
  const provider = new TextractProvider({ send: async (command: unknown) => {
    calls.push(command); return { Blocks: [{ BlockType: "LINE", Text: "A document", Confidence: 98 }] };
  } } as any, async () => [Buffer.from("page")], async () => { throw new Error("Classifier exhausted"); });
  await assert.rejects(provider.extract(Buffer.from("file"), "application/pdf", "auto"), /Classifier exhausted/);
  assert.equal(calls.length, 1);
});
