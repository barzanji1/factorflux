import { z } from "zod";
import { displayLoadType, LOAD_TYPES } from "./load-types";

const optional = (value: unknown) => value === "" || value == null ? undefined : value;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid date.");
export const agingReportFiltersSchema = z.object({
  view: z.enum(["carrier", "broker"]),
  search: z.string().trim().max(200).optional().default(""),
  startDate: z.preprocess(optional, day.optional()),
  endDate: z.preprocess(optional, day.optional()),
  minAmount: z.preprocess(optional, z.coerce.number().finite().nonnegative().max(999999999999.99).optional()),
  maxAmount: z.preprocess(optional, z.coerce.number().finite().nonnegative().max(999999999999.99).optional()),
  status: z.enum(["all", "funded", "held"]).optional().default("all"),
  loadType: z.enum(["all", ...LOAD_TYPES]).optional().default("all"),
}).strict().superRefine((value, ctx) => {
  if (value.startDate && value.endDate && value.startDate > value.endDate)
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after start date." });
  if (value.minAmount !== undefined && value.maxAmount !== undefined && value.minAmount > value.maxAmount)
    ctx.addIssue({ code: "custom", path: ["maxAmount"], message: "Maximum amount must be at least minimum." });
});
export type AgingReportFilters = z.infer<typeof agingReportFiltersSchema>;
export const AGING_COLUMNS = [
  { key: "current", label: "Current" },
  { key: "days1to30", label: "1–30" },
  { key: "days31to60", label: "31–60" },
  { key: "days61to90", label: "61–90" },
  { key: "over90", label: "90+" },
] as const;
export type AgingBucket = typeof AGING_COLUMNS[number]["key"];
export type AgingAmounts = Record<AgingBucket, number>;
export interface AgingGroup {
  id: string;
  name: string;
  invoiceCount: number;
  buckets: AgingAmounts;
  total: number;
}
export interface AgingInvoiceDetail {
  invoiceId: number;
  invoiceNumber: string;
  carrier: string | null;
  broker: string | null;
  amount: number;
  outstanding: number;
  ageDays: number;
  fundedAt: string;
  confirmationStatus: string;
}
export interface GroupedAgingReport {
  view: AgingReportFilters["view"];
  rows: AgingGroup[];
  totals: Omit<AgingGroup, "id" | "name">;
  invoices: AgingInvoiceDetail[];
}
export interface AgingSourceRow {
  invoiceId: number;
  invoiceNumber: string;
  carrierId: number | null;
  brokerId: number | null;
  debtorId: number | null;
  carrier: string | null;
  broker: string | null;
  amount: number;
  outstanding: number;
  ageDays: number;
  fundedAt: Date | null;
  status: string;
  loadType: string | null;
  confirmationStatus: string;
}
const blankBuckets = (): AgingAmounts => ({ current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 });
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
});
function fundedDay(date: Date) {
  const parts = dayFormatter.formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function agingBucket(age: number): AgingBucket {
  if (age <= 0) return "current";
  if (age <= 30) return "days1to30";
  if (age <= 60) return "days31to60";
  if (age <= 90) return "days61to90";
  return "over90";
}

/** Reshape the existing scoped aging source; do not recalculate eligibility,
 * outstanding balances or age using another invoice/payment query. */
export function groupAgingRows(source: AgingSourceRow[], input: unknown): GroupedAgingReport {
  const filters = agingReportFiltersSchema.parse(input);
  const groups = new Map<string, AgingGroup>();
  const report: GroupedAgingReport = {
    view: filters.view, rows: [], totals: { invoiceCount: 0, buckets: blankBuckets(), total: 0 }, invoices: [],
  };
  // Aggregate integer cents, then convert once, so every row/column reconciles.
  for (const invoice of source) {
    if (!invoice.fundedAt || invoice.outstanding <= 0) continue;
    const date = fundedDay(invoice.fundedAt);
    const name = (filters.view === "carrier" ? invoice.carrier : invoice.broker) || `Unknown ${filters.view}`;
    if (filters.search && !name.toLocaleLowerCase().includes(filters.search.toLocaleLowerCase())) continue;
    if (filters.startDate && date < filters.startDate || filters.endDate && date > filters.endDate) continue;
    if (filters.minAmount !== undefined && invoice.outstanding < filters.minAmount
      || filters.maxAmount !== undefined && invoice.outstanding > filters.maxAmount) continue;
    if (filters.status !== "all" && invoice.status !== filters.status) continue;
    if (filters.loadType !== "all" && displayLoadType(invoice.loadType) !== filters.loadType) continue;
    const id = filters.view === "carrier" ? `carrier:${invoice.carrierId ?? "unknown"}`
      : invoice.brokerId != null ? `broker:${invoice.brokerId}`
        : invoice.debtorId != null ? `debtor:${invoice.debtorId}` : "broker:unknown";
    const group = groups.get(id) ?? { id, name, invoiceCount: 0, buckets: blankBuckets(), total: 0 };
    const cents = Math.round(invoice.outstanding * 100);
    const bucket = agingBucket(invoice.ageDays);
    if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(report.totals.total + cents))
      throw new Error("Aging report amount exceeds safe monetary precision.");
    group.invoiceCount++;
    group.buckets[bucket] += cents;
    group.total += cents;
    groups.set(id, group);
    report.totals.invoiceCount++;
    report.totals.buckets[bucket] += cents;
    report.totals.total += cents;
    report.invoices.push({
      invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber, carrier: invoice.carrier, broker: invoice.broker,
      amount: invoice.amount, outstanding: invoice.outstanding, ageDays: invoice.ageDays,
      fundedAt: invoice.fundedAt.toISOString(), confirmationStatus: invoice.confirmationStatus,
    });
  }
  const toDollars = (value: GroupedAgingReport["totals"]) => {
    for (const { key } of AGING_COLUMNS) value.buckets[key] /= 100;
    value.total /= 100;
  };
  report.rows = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  report.rows.forEach(toDollars);
  toDollars(report.totals);
  return report;
}

export function agingReportCsv(report: GroupedAgingReport): string {
  const cell = (value: string | number) => {
    if (typeof value === "number") return `"${value.toFixed(2)}"`;
    const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows: Array<Array<string | number>> = [
    ["Trucking Pros Financial", report.view === "carrier" ? "By Carrier" : "By Broker"],
    [report.view === "carrier" ? "Carrier" : "Broker", "Invoices", ...AGING_COLUMNS.map(column => column.label), "Total"],
    ...report.rows.map(row => [row.name, String(row.invoiceCount), ...AGING_COLUMNS.map(({ key }) => row.buckets[key]), row.total]),
    ["TOTAL", String(report.totals.invoiceCount), ...AGING_COLUMNS.map(({ key }) => report.totals.buckets[key]), report.totals.total],
  ];
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n");
}
