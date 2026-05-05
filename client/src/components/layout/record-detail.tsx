import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ExternalLink } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordMetric {
  label: string;
  value: string;
  tint?: "violet" | "amber" | "blue" | "emerald" | "slate" | "red" | "orange";
}

export interface LinkedRecord {
  label: string;
  icon: React.ReactNode;
  value: string;
  sub?: string;
  href?: string;
  tint?: "blue" | "violet" | "emerald" | "amber" | "slate";
}

export interface RecordTab {
  value: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
  alert?: boolean;
  content: React.ReactNode;
}

export interface RecordDetailProps {
  backHref: string;
  backLabel: string;
  icon: React.ReactNode;
  iconBg?: string;
  title: string;
  titleSub?: string;
  statusBadge?: React.ReactNode;
  metrics?: RecordMetric[];
  statusStrip?: React.ReactNode;
  alertBanner?: React.ReactNode;
  actions?: React.ReactNode;
  linkedRecords?: LinkedRecord[];
  rightExtra?: React.ReactNode;
  tabs: RecordTab[];
  defaultTab?: string;
  isLoading?: boolean;
  notFound?: boolean;
  notFoundIcon?: React.ReactNode;
  notFoundLabel?: string;
}

// ─── Metric tint map ──────────────────────────────────────────────────────────

const TINT: Record<string, string> = {
  violet:  "text-violet-600 dark:text-violet-400",
  amber:   "text-amber-600 dark:text-amber-400",
  blue:    "text-blue-600 dark:text-blue-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  slate:   "text-slate-700 dark:text-slate-300",
  red:     "text-red-600 dark:text-red-400",
  orange:  "text-orange-600 dark:text-orange-400",
};

const LINKED_TINT: Record<string, { icon: string; bg: string }> = {
  blue:    { icon: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-950/30" },
  violet:  { icon: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/30" },
  emerald: { icon: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
  amber:   { icon: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-950/30" },
  slate:   { icon: "text-slate-500 dark:text-slate-400",  bg: "bg-slate-100 dark:bg-slate-800" },
};

// ─── Skeleton loading state ───────────────────────────────────────────────────

function RecordDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-40 rounded-xl" />
      <Skeleton className="h-44 w-full rounded-[28px]" />
      <div className="flex gap-5">
        <Skeleton className="h-96 flex-1 rounded-[28px]" />
        <Skeleton className="h-96 w-72 shrink-0 rounded-[28px]" />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RecordDetail({
  backHref,
  backLabel,
  icon,
  iconBg = "bg-blue-600 text-white shadow-[0_8px_20px_rgba(37,99,235,0.28)]",
  title,
  titleSub,
  statusBadge,
  metrics = [],
  statusStrip,
  alertBanner,
  actions,
  linkedRecords = [],
  rightExtra,
  tabs,
  defaultTab,
  isLoading,
  notFound,
  notFoundIcon,
  notFoundLabel = "Record not found",
}: RecordDetailProps) {
  const [, navigate] = useLocation();

  if (isLoading) return <RecordDetailSkeleton />;

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-600">
          {notFoundIcon}
        </div>
        <p className="text-lg font-semibold text-slate-700 dark:text-white">{notFoundLabel}</p>
        <Button variant="ghost" onClick={() => navigate(backHref)}
          className="mt-4 gap-2 rounded-xl text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="h-4 w-4" />{backLabel}
        </Button>
      </div>
    );
  }

  const firstTab = defaultTab ?? tabs[0]?.value;

  return (
    <div className="space-y-5">
      {/* Back button */}
      <Button variant="ghost" onClick={() => navigate(backHref)}
        className="-ml-2 gap-2 rounded-xl text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" />{backLabel}
      </Button>

      {/* ── Alert banner ─────────────────────────────────────────────────────── */}
      {alertBanner}

      {/* ── Header card ──────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl", iconBg)}>
              {icon}
            </div>
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
                {statusBadge}
              </div>
              {titleSub && (
                <p className="text-sm text-slate-500 dark:text-slate-400">{titleSub}</p>
              )}
            </div>
          </div>
          {metrics.length > 0 && metrics.slice(0, 1).map(m => (
            <div key={m.label} className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{m.label}</p>
              <p className={cn("text-3xl font-semibold tracking-tight", TINT[m.tint ?? "slate"])}>
                {m.value}
              </p>
            </div>
          ))}
        </div>

        {metrics.length > 1 && (
          <div className={cn(
            "grid divide-x divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800",
            metrics.slice(1).length === 1 && "grid-cols-1",
            metrics.slice(1).length === 2 && "grid-cols-2",
            metrics.slice(1).length === 3 && "grid-cols-3 sm:grid-cols-3",
            metrics.slice(1).length >= 4 && "grid-cols-2 sm:grid-cols-4",
          )}>
            {metrics.slice(1).map(m => (
              <div key={m.label} className="p-4 text-center">
                <p className={cn("text-xl font-semibold", TINT[m.tint ?? "slate"])}>{m.value}</p>
                <p className="mt-0.5 text-xs text-slate-400">{m.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Status strip (pipeline, progress bar, etc.) ───────────────────────── */}
      {statusStrip && (
        <div className="rounded-[24px] border border-slate-200/80 bg-white/90 px-6 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
          {statusStrip}
        </div>
      )}

      {/* ── Two-column body ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">

        {/* Main — tabs */}
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
            <Tabs defaultValue={firstTab}>
              <div className="border-b border-slate-100 px-6 pt-5 dark:border-slate-800">
                <TabsList className="h-auto gap-1 rounded-none bg-transparent p-0 flex-wrap">
                  {tabs.map(({ value, label, icon: tabIcon, count, alert }) => (
                    <TabsTrigger key={value} value={value}
                      className="flex items-center gap-1.5 rounded-none border-b-2 border-transparent px-3 pb-3 pt-1 text-xs font-semibold text-slate-500 transition-colors data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 dark:text-slate-400 dark:data-[state=active]:text-blue-300">
                      {tabIcon}{label}
                      {!!count && count > 0 && (
                        <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{count}</span>
                      )}
                      {alert && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-500" />}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              {tabs.map(({ value, content }) => (
                <TabsContent key={value} value={value} className="p-6">
                  {content}
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </div>

        {/* Right rail — sticky */}
        <div className="w-full shrink-0 space-y-4 xl:w-72 xl:sticky xl:top-6">

          {/* Actions card */}
          {actions && (
            <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
              {actions}
            </div>
          )}

          {/* Linked records */}
          {linkedRecords.length > 0 && (
            <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
              <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Linked Records</h3>
              </div>
              <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
                {linkedRecords.map((lr, idx) => {
                  const t = LINKED_TINT[lr.tint ?? "slate"];
                  return (
                    <div key={idx} className="flex items-center gap-3 px-5 py-3.5">
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", t.bg, t.icon)}>
                        {lr.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-slate-400">{lr.label}</p>
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{lr.value}</p>
                        {lr.sub && <p className="truncate text-[11px] text-slate-400">{lr.sub}</p>}
                      </div>
                      {lr.href && (
                        <a href={lr.href}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Extra right-rail slots */}
          {rightExtra}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers re-exported for detail pages ─────────────────────────────────────

export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
      <span className="text-xs font-medium text-slate-400 whitespace-nowrap">{label}</span>
      <span className="text-right text-xs font-semibold text-slate-700 dark:text-slate-200">{value ?? "—"}</span>
    </div>
  );
}

export function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

export function EmptyTab({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
