import { z } from "zod";

const optional = (value: unknown) => value === "" || value == null ? undefined : value;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid date.");
export const chargebackReportFiltersSchema = z.object({
  startDate: z.preprocess(optional, day.optional()),
  endDate: z.preprocess(optional, day.optional()),
  carrierId: z.preprocess(optional, z.coerce.number().int().positive().optional()),
  brokerId: z.preprocess(optional, z.coerce.number().int().positive().optional()),
  status: z.enum(["all", "open", "collected", "written_off", "applied"]).optional().default("all"),
  minAmount: z.preprocess(optional, z.coerce.number().finite().nonnegative().max(999999999999.99).optional()),
  maxAmount: z.preprocess(optional, z.coerce.number().finite().nonnegative().max(999999999999.99).optional()),
}).strict().superRefine((value, ctx) => {
  if (value.startDate && value.endDate && value.startDate > value.endDate)
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after start date." });
  if (value.minAmount !== undefined && value.maxAmount !== undefined && value.minAmount > value.maxAmount)
    ctx.addIssue({ code: "custom", path: ["maxAmount"], message: "Maximum amount must be at least the minimum." });
});
export type ChargebackReportFilters = z.infer<typeof chargebackReportFiltersSchema>;
export type ChargebackReportSection = "chargebacks" | "shortPays" | "deductions";
export interface ChargebackReportRow {
  id: string;
  section: ChargebackReportSection;
  date: string | null;
  invoiceId: number;
  invoiceNumber: string;
  carrierId: number;
  carrierName: string;
  brokerId: number | null;
  brokerName: string;
  originalAmount: number;
  cashApplied: number;
  amount: number | null;
  outstanding: number;
  reason: string;
  status: "open" | "collected" | "written_off" | "applied";
  kind: string;
  amountSource: string;
}
export interface ChargebackReportTotals {
  count: number;
  originalAmount: number;
  cashApplied: number;
  amount: number;
  outstanding: number;
  unknownAmounts: number;
}
export interface ChargebackReport {
  chargebacks: ChargebackReportRow[];
  shortPays: ChargebackReportRow[];
  deductions: ChargebackReportRow[];
  totals: Record<ChargebackReportSection, ChargebackReportTotals>;
  notices: string[];
}
