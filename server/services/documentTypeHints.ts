import type { AIClassificationResult } from "./aiClassifier";

/** Explicit slots win; filenames are hints only when the agent did not choose a type. */
export function filenameDocumentType(filename: string): string | null {
  const name = filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").toLowerCase();
  const patterns: [RegExp, string][] = [
    [/lumper/i, "lumper_receipt"],
    [/(?:^|[^a-z])(?:rate[\s_-]*con(?:firmation)?|rc-)/i, "rate_confirmation"],
    [/(?:^|[^a-z])bol(?:$|[^a-z])/i, "bill_of_lading"],
    [/(?:^|[^a-z])pod(?:$|[^a-z])/i, "proof_of_delivery"],
    [/(?:^|[^a-z])release(?:$|[^a-z])/i, "release_letter"],
    [/(?:^|[^a-z])noa(?:$|[^a-z])/i, "noa"],
    [/(?:^|[^a-z])weight[\s_-]*ticket(?:$|[^a-z])/i, "weight_ticket"],
    [/(?:^|[^a-z])dispatch(?:$|[^a-z])/i, "dispatch_sheet"],
    [/(?:^|[^a-z])invoice(?:$|[^a-z])/i, "freight_invoice"],
  ];
  return patterns.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export function presetDocumentClassification(document?: {
  originalName?: string; documentType?: string | null;
  finalDocumentType?: string | null; classificationSource?: string | null;
}): AIClassificationResult | null {
  const explicit = document?.classificationSource === "agent"
    ? document.finalDocumentType ?? document.documentType : null;
  const chosen = explicit && !["other", "auto"].includes(explicit) ? explicit : null;
  const type = chosen ?? filenameDocumentType(document?.originalName ?? "");
  if (!type) return null;
  return {
    docType: type, confidence: 1, signals: [chosen ? "Explicit agent slot" : "Filename category hint"],
    reasoning: chosen ? "Agent-selected document type takes priority." : "Recognized document category in filename.",
    allScores: { [type]: 1 }, model: chosen ? "agent-slot" : "filename-pattern",
    source: "rules",
  };
}
