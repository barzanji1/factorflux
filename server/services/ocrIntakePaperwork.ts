import { createHash } from "node:crypto";
import { IntakeError, type IntakeDocument } from "./ocrIntakeMapping";

export function reusableIntakePaperwork(files: Record<string, Express.Multer.File[]>, docs: IntakeDocument[]) {
  if (docs.some(doc => doc.invoiceId != null)) throw new IntakeError("An intake document is already attached to an invoice", 409);
  const reused = new Map<string, number>();
  for (const [slot, uploaded] of Object.entries(files)) {
    uploaded.forEach((file, index) => {
      const hash = createHash("sha256").update(file.buffer).digest("hex");
      // Hash identity is independent of classification. Named slots override the
      // reused document's type atomically when the invoice is committed.
      const match = docs.find(doc => doc.contentHash === hash);
      if (match) reused.set(index === 0 ? slot : `${slot}:${index}`, match.documentId);
    });
  }
  return reused;
}
