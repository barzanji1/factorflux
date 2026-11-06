export type PaperworkSlot = "rateConfirmation" | "billOfLading" | "lumperReceipt" | "documents" | "documents2" | "documents3";
type RoutedDocument = { filename: string; docType?: string; status: string };

/** Keep manual placements. Route bulk intake only into otherwise unassigned slots. */
export function routeIntakePaperwork<T extends { name: string; size?: number; lastModified?: number }>(
  current: Record<PaperworkSlot, T[]>, files: T[], documents: RoutedDocument[],
) {
  const paperwork = Object.fromEntries(Object.entries(current).map(([key, value]) => [key, [...value]])) as Record<PaperworkSlot, T[]>;
  const added: Partial<Record<PaperworkSlot, T[]>> = {};
  const used = new Set<T>();
  const assigned = new Set(Object.values(current).flat());
  for (const document of documents) {
    if (document.status !== "completed") continue;
    const file = files.find(candidate => candidate.name === document.filename && !used.has(candidate));
    if (!file) continue;
    used.add(file);
    if (assigned.has(file) || Array.from(assigned).some(candidate =>
      candidate.name === file.name && typeof candidate.size === "number" && candidate.size === file.size
      && typeof candidate.lastModified === "number" && candidate.lastModified === file.lastModified)) continue;
    const type = document.docType;
    let slot: PaperworkSlot;
    if (type === "rate_confirmation") slot = "rateConfirmation";
    else if (["bol", "pod", "bol_pod", "bill_of_lading", "proof_of_delivery"].includes(type ?? "")) slot = "billOfLading";
    else if (type === "lumper_receipt") slot = "lumperReceipt";
    else slot = (["documents", "documents2", "documents3"] as const).find(key => paperwork[key].length === 0) ?? "documents";
    paperwork[slot].push(file);
    (added[slot] ??= []).push(file);
    assigned.add(file);
  }
  return { paperwork, added };
}
