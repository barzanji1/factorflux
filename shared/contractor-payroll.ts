export type PayrollCadence = "weekly" | "biweekly" | "monthly" | "custom";
export interface PayPeriod {
  id: number; startDate: string; endDate: string; timezone: string;
  cadence: PayrollCadence; status: "draft" | "locked"; createdAt: string;
  lockedBy: string | null; lockedAt: string | null;
}
export interface PayDay { date: string; minutes: number }
export interface PayrollTimeEntry {
  id: number; userId: string; clockInTime: string; clockOutTime: string | null;
  flags: string[];
}
export interface ContractorHours {
  id: string; name: string; minutes: number; decimalHours: string; hoursDisplay: string;
  daily: PayDay[]; entries: PayrollTimeEntry[]; flags: string[];
  approved: boolean; approvedBy: string | null; approvedAt: string | null;
  rateCents?: number | null; issuedStatement?: PayStatement | null;
}
export interface PayStatement {
  id: number; statementNumber: string; contractorId: string; contractorName: string;
  periodId: number; startDate: string; endDate: string; payDate: string;
  minutes: number; rateCents: number; grossCents: number; ytdGrossCents: number;
  status: "issued" | "void"; issuedAt: string; voidedAt: string | null;
  voidReason: string | null; replacesStatementId: number | null;
}
export interface PayrollList {
  isAdmin: boolean; statements: PayStatement[]; total: number; page: number; ytdGrossCents: number;
}
export interface PayrollAdmin {
  contractors: { id: string; name: string; rateCents: number | null }[];
  periods: PayPeriod[]; cadence: PayrollCadence; timezone: string;
  contractorPage: number; contractorTotal: number; periodPage: number; periodTotal: number;
}
export interface PayrollReview { period: PayPeriod; contractors: ContractorHours[] }
export const PAYROLL_PAGE_SIZE = 15;
