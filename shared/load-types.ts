export const LOAD_TYPES = [
  "otr_load",
  "dump_truck_ticket",
  "hotshot",
  "other",
] as const;

export type LoadType = (typeof LOAD_TYPES)[number];

export const LOAD_TYPE_LABELS: Record<LoadType, string> = {
  otr_load: "OTR",
  dump_truck_ticket: "Dump",
  hotshot: "Hotshot",
  other: "Other",
};

export function isLoadType(value: unknown): value is LoadType {
  return typeof value === "string" && (LOAD_TYPES as readonly string[]).includes(value);
}

/** Legacy/null values are intentionally displayed as Other without rewriting storage. */
export function displayLoadType(value: unknown): LoadType {
  return isLoadType(value) ? value : "other";
}