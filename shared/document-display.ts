export type DocumentClassification = {
  finalDocumentType?: string | null;
  candidateDocumentType?: string | null;
  aiDocumentType?: string | null;
  documentType?: string | null;
};

export function documentClassification(doc: DocumentClassification): string {
  return doc.finalDocumentType || doc.candidateDocumentType || doc.aiDocumentType || doc.documentType || "other";
}

export function documentClassificationLabel(type: string): string {
  const labels: Record<string, string> = {
    rate_confirmation: "Rate Confirmation", freight_invoice: "Freight Invoice",
    invoice: "Freight Invoice", commercial_invoice: "Commercial Invoice",
    bill_of_lading: "Bill of Lading", bol: "Bill of Lading",
    proof_of_delivery: "Proof of Delivery", pod: "Proof of Delivery",
    lumper_receipt: "Lumper Receipt", receipt: "Receipt",
    noa: "Notice of Assignment", release_letter: "Release Letter", other: "Other",
  };
  return labels[type] || type.replace(/_/g, " ");
}
