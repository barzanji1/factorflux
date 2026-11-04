/** Full-dataset summaries; never derived from a paginated table's visible rows. */
export interface PageInsights {
  total: number;
  open: number;
  openLabel?: string;
  keyMetric: { label: string; value: number; format: "number" | "currency" };
  breakdown: Array<{ name: string; value: number }>;
  series: Array<{ period: string; count: number; amount: number }>;
  /** Complete page-specific stat row when supplied; values cover authorized rows. */
  extraMetrics?: InsightMetric[];
  charts?: InsightChart[];
}

export interface InsightMetric {
  label: string;
  value: number;
  format: "number" | "currency" | "days" | "hours" | "datetime" | "percent";
}
export interface InsightChart {
  title: string;
  kind: "cylinder" | "donut" | "area";
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; label: string; color: string; format?: "number" | "currency" | "percent" }>;
  xKey?: string;
}

export const INSIGHT_ENTITIES = [
  "invoices", "clients", "brokers", "documents", "followups", "tasks", "email-log",
  "client-email", "factoring", "sheets", "payouts", "cash-application", "lockbox",
  "fuel-advance", "bank-transfers", "held", "exceptions", "credit-checks",
  "fmcsa-authority", "audit-log", "activities", "reports", "dispatchers", "trucks",
  "release-letters", "bulk-invoices", "portal-submissions", "admin", "payroll",
  "expenses", "vault", "document-rules", "workflow-builder", "calendar",
  "it-support", "collections", "loads", "tickets",
] as const;
export type InsightEntity = typeof INSIGHT_ENTITIES[number];
