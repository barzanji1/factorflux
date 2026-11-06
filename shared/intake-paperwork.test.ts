import test from "node:test";
import assert from "node:assert/strict";
import { routeIntakePaperwork, type PaperworkSlot } from "./intake-paperwork";

type FileStub = { name: string; size?: number; lastModified?: number };
const empty = (): Record<PaperworkSlot, FileStub[]> => ({
  rateConfirmation: [], billOfLading: [], lumperReceipt: [], documents: [], documents2: [], documents3: [],
});
test("bulk intake routes named types and multiple BOLs; supporting documents fill generic slots", () => {
  const types = ["rate_confirmation", "bol", "pod", "lumper_receipt", "invoice", "weight_ticket", "dispatch_sheet", "noa"];
  const files = types.map((type, index) => ({ name: `${type}-${index}.pdf` }));
  const documents = files.map((file, i) => ({ filename: file.name, docType: types[i], status: "completed" }));
  const { paperwork } = routeIntakePaperwork(empty(), files, documents);
  assert.deepEqual(paperwork.rateConfirmation, [files[0]]);
  assert.deepEqual(paperwork.billOfLading, [files[1], files[2]]);
  assert.deepEqual(paperwork.lumperReceipt, [files[3]]);
  assert.deepEqual(paperwork.documents, [files[4], files[7]]);
  assert.deepEqual(paperwork.documents2, [files[5]]);
  assert.deepEqual(paperwork.documents3, [files[6]]);
  assert.equal(Object.values(paperwork).flat().length, files.length);
});
test("manual assignments stay in their slot even if bulk classification disagrees", () => {
  const file = { name: "INVOICE-5.pdf", size: 50, lastModified: 100 };
  const current = empty();
  current.lumperReceipt = [file];
  const { paperwork, added } = routeIntakePaperwork(current, [{ ...file }],
    [{ filename: file.name, docType: "invoice", status: "completed" }]);
  assert.deepEqual(paperwork.lumperReceipt, [file]);
  assert.equal(paperwork.documents.length, 0);
  assert.deepEqual(added, {});
});
test("files with the same name are not lost, and failed jobs never auto-route", () => {
  const a = { name: "scan.pdf" }, b = { name: "scan.pdf" }, failed = { name: "failed.pdf" };
  const { paperwork } = routeIntakePaperwork(empty(), [a, b, failed], [
    { filename: "scan.pdf", docType: "lumper_receipt", status: "completed" },
    { filename: "scan.pdf", docType: "lumper_receipt", status: "completed" },
    { filename: "failed.pdf", docType: "invoice", status: "failed" },
  ]);
  assert.deepEqual(paperwork.lumperReceipt, [a, b]);
  assert.equal(Object.values(paperwork).flat().length, 2);
});
