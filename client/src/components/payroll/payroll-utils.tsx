import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/admin-neu/adapters";
import type { PayPeriod } from "../../../../shared/contractor-payroll";

export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const timestampLabel = (value: string) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
export const isPeriodLocked = (period: PayPeriod) => period.status === "locked";

export function ErrorNotice({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-300/70 bg-rose-50/80 px-4 py-3 text-sm text-rose-800">
    <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{message}</span>
    {onRetry && <Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry</Button>}
  </div>;
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" }) {
  const success = tone === "success";
  const Icon = success ? CheckCircle2 : Info;
  return <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${success ? "bg-emerald-50 text-emerald-800" : "bg-sky-50 text-sky-900"}`}>
    <Icon className="mt-0.5 h-4 w-4 shrink-0" /> <div>{children}</div>
  </div>;
}

export function periodLabel(period: PayPeriod) {
  return `${dateLabel(period.startDate)} – ${dateLabel(period.endDate)}`;
}

export function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "The request could not be completed. Please try again.";
  try {
    const parsed = JSON.parse(error.message);
    return parsed.message ?? error.message;
  } catch {
    return error.message || "The request could not be completed. Please try again.";
  }
}
