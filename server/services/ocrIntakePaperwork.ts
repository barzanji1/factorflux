import { createHash } from "node:crypto";
import { IntakeError, type IntakeDocument } from "./ocrIntakeMapping";

export function reusableIntakePaperwork(files: Record<string, Express.Multer.File[]>, docs: IntakeDocument[]) {
  if (docs.some(doc => doc.invoiceId != null)) throw new IntakeError("An intake document is already attached to an invoice", 409);
  const expected: Record<string, string[]> = { rateConfirmation: ["rate_confirmation"], billOfLading: ["bol", "pod"],
    carrierInvoice: ["invoice"], proofOfDelivery: ["pod", "bol"],
    weightTicket: ["weight_ticket"], dispatchSheet: ["dispatch_sheet"],
    other: ["invoice", "other"], lumperReceipt: ["lumper_receipt"] };
  const reused = new Map<string, number>();
  for (const [slot, uploaded] of Object.entries(files)) {
    uploaded.forEach((file, index) => {
      const hash = createHash("sha256").update(file.buffer).digest("hex");
      // Generic supporting uploads may already have any OCR classification.
      const match = docs.find(doc => doc.contentHash === hash && (slot === "other" || expected[slot]?.includes(doc.docType)));
      if (match) reused.set(index === 0 ? slot : `${slot}:${index}`, match.documentId);
    });
  }
  return reused;
}
