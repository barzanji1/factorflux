import { createHash } from "node:crypto";
import { IntakeError, type IntakeDocument } from "./ocrIntakeMapping";

export function reusableIntakePaperwork(files: Record<string, Express.Multer.File[]>, docs: IntakeDocument[]) {
  if (docs.some(doc => doc.invoiceId != null)) throw new IntakeError("An intake document is already attached to an invoice", 409);
  const expected: Record<string, string[]> = { rateConfirmation: ["rate_confirmation"], billOfLading: ["bol", "pod"],
    other: ["invoice", "other"], lumperReceipt: ["lumper_receipt"] };
  const reused = new Map<string, number>();
  for (const [slot, uploaded] of Object.entries(files)) {
    const file = uploaded[0];
    if (!file) continue;
    const hash = createHash("sha256").update(file.buffer).digest("hex");
    const match = docs.find(doc => doc.contentHash === hash && expected[slot]?.includes(doc.docType));
    if (match) reused.set(slot, match.documentId);
  }
  return reused;
}
