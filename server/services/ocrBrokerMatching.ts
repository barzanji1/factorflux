import { sql } from "drizzle-orm";
import { db } from "../db";

export interface BrokerMatch {
  brokerId: number | null;
  confidence: "high" | "medium" | null;
  rawName: string | null;
  matchedName: string | null;
  candidates: Array<{ id: number; name: string }>;
}
export interface BrokerDirectoryEntry {
  id: number;
  name: string;
  aliases?: string[];
}

export function normalizeBrokerName(name: string): string {
  return name.toUpperCase()
    .replace(/\b(?:L\.?L\.?C\.?|I\.?N\.?C\.?|C\.?O\.?R\.?P\.?|L\.?T\.?D\.?)\b/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// pg_trgm similarity for a normalized single word: unique padded trigrams,
// shared / union. No extension or per-broker network query is required.
export function trigramSimilarity(a: string, b: string): number {
  const grams = (value: string) => {
    const padded = `  ${value} `;
    return new Set(Array.from({ length: Math.max(0, padded.length - 2) },
      (_, index) => padded.slice(index, index + 3)));
  };
  const left = grams(a), right = grams(b);
  const shared = [...left].filter(gram => right.has(gram)).length;
  return shared / (left.size + right.size - shared || 1);
}

export function withinTwoEdits(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(
      current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...current) > 2) return false;
    previous = current;
  }
  return previous[b.length] <= 2;
}

export function matchBrokerName(rawName: string | null, directory: BrokerDirectoryEntry[]): BrokerMatch {
  const result: BrokerMatch = { brokerId: null, confidence: null, rawName, matchedName: null, candidates: [] };
  const normalized = normalizeBrokerName(rawName ?? "");
  if (!normalized) return result;
  const matches = directory.flatMap(broker => {
    const names = [broker.name, ...(broker.aliases ?? [])].map(normalizeBrokerName).filter(Boolean);
    const exact = names.includes(normalized);
    const fuzzy = exact || names.some(name =>
      trigramSimilarity(normalized, name) >= .85 || withinTwoEdits(normalized, name));
    return fuzzy ? [{ ...broker, confidence: exact ? "high" as const : "medium" as const }] : [];
  });
  // A matching alias and legal name for one broker count as one candidate.
  const unique = [...new Map(matches.map(match => [match.id, match])).values()];
  result.candidates = unique.map(({ id, name }) => ({ id, name }));
  if (unique.length === 1) {
    result.brokerId = unique[0].id;
    result.confidence = unique[0].confidence;
    result.matchedName = unique[0].name;
  }
  return result;
}

export function brokerAliases(record: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!/^(?:dba|dbaname|alias|aliases|aliasname|aliasnames|tradename|tradenames)$/.test(key.toLowerCase().replace(/_/g, ""))) continue;
    if (Array.isArray(value)) result.push(...value.filter((item): item is string => typeof item === "string"));
    else if (typeof value === "string") {
      result.push(value);
      if (/alias|names/.test(key.toLowerCase())) {
        try {
          const parsed: unknown = JSON.parse(value);
          if (Array.isArray(parsed)) result.push(...parsed.filter((item): item is string => typeof item === "string"));
        } catch { result.push(...value.split(/[;\n,]/)); }
      }
    }
  }
  return result.map(alias => alias.trim()).filter(Boolean);
}

export async function findOcrBrokerMatch(rawName: string | null, database: Pick<typeof db, "execute"> = db): Promise<BrokerMatch> {
  if (!rawName?.trim()) return matchBrokerName(rawName, []);
  // JSON projection includes any existing DBA/alias columns, without adding or
  // assuming columns that the current broker schema does not contain.
  const rows = await database.execute(sql`SELECT id, name, to_jsonb(b) AS record FROM brokers b`);
  return matchBrokerName(rawName, rows.rows.map(row => ({
    id: Number(row.id), name: String(row.name),
    aliases: brokerAliases(row.record as Record<string, unknown>),
  })));
}
