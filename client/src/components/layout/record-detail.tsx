import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { NeuButton as Button } from "@/styles/neu/components";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { NeuCard, NeuTab, NeuTabList, NeuTabPanel, NeuTabs } from "@/styles/neu/components";

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
  violet:  "text-[#168d99]",
  amber:   "text-[#9b6a22]",
  blue:    "text-[#168d99]",
  emerald: "text-[#168d99]",
  slate:   "text-[#555]",
  red:     "text-[#a3483e]",
  orange:  "text-[#9b6a22]",
};

const LINKED_TINT: Record<string, { icon: string; bg: string }> = {
  blue:    { icon: "text-[#168d99]", bg: "bg-[#dceaea]" },
  violet:  { icon: "text-[#168d99]", bg: "bg-[#dceaea]" },
  emerald: { icon: "text-[#168d99]", bg: "bg-[#dceaea]" },
  amber:   { icon: "text-[#9b6a22]", bg: "bg-[#f0e9db]" },
  slate:   { icon: "text-[#666]", bg: "bg-[#d7d7d7]" },
};

// ─── Skeleton loading state ───────────────────────────────────────────────────

function RecordDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-40 rounded-xl bg-[#d2d2d2]" />
      <Skeleton className="h-44 w-full rounded-[28px] bg-[#d2d2d2]" />
      <div className="flex gap-5">
        <Skeleton className="h-96 flex-1 rounded-[28px] bg-[#d2d2d2]" />
        <Skeleton className="h-96 w-72 shrink-0 rounded-[28px] bg-[#d2d2d2]" />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RecordDetail({
  backHref,
  backLabel,
  icon,
  iconBg = "bg-[#e0e0e0] text-[#168d99] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]",
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
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e0e0e0] text-[#999] shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8]">
          {notFoundIcon}
        </div>
        <p className="text-lg font-semibold text-[#444]">{notFoundLabel}</p>
        <Button variant="ghost" onClick={() => navigate(backHref)}
          className="mt-4 gap-2 rounded-xl text-sm text-[#666] hover:text-[#168d99]">
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
        className="-ml-2 gap-2 rounded-xl text-sm text-[#666] hover:text-[#168d99]">
        <ArrowLeft className="h-4 w-4" />{backLabel}
      </Button>

      {/* ── Alert banner ─────────────────────────────────────────────────────── */}
      {alertBanner}

      {/* ── Header card ──────────────────────────────────────────────────────── */}
      <NeuCard className="overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl", iconBg)}>
              {icon}
            </div>
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight text-[#333]">{title}</h1>
                {statusBadge}
              </div>
              {titleSub && (
                <p className="text-sm text-[#666]">{titleSub}</p>
              )}
            </div>
          </div>
          {metrics.length > 0 && metrics.slice(0, 1).map(m => (
            <div key={m.label} className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-[#777]">{m.label}</p>
              <p className={cn("text-3xl font-semibold tracking-tight", TINT[m.tint ?? "slate"])}>
                {m.value}
              </p>
            </div>
          ))}
        </div>

        {metrics.length > 1 && (
          <div className={cn(
            "grid divide-x divide-[#c9c9c9] border-t border-[#c9c9c9]",
            metrics.slice(1).length === 1 && "grid-cols-1",
            metrics.slice(1).length === 2 && "grid-cols-2",
            metrics.slice(1).length === 3 && "grid-cols-3 sm:grid-cols-3",
            metrics.slice(1).length >= 4 && "grid-cols-2 sm:grid-cols-4",
          )}>
            {metrics.slice(1).map(m => (
              <div key={m.label} className="p-4 text-center">
                <p className={cn("text-xl font-semibold", TINT[m.tint ?? "slate"])}>{m.value}</p>
                <p className="mt-0.5 text-xs text-[#777]">{m.label}</p>
              </div>
            ))}
          </div>
        )}
      </NeuCard>

      {/* ── Status strip (pipeline, progress bar, etc.) ───────────────────────── */}
      {statusStrip && (
        <NeuCard className="rounded-2xl px-6 py-5">
          {statusStrip}
        </NeuCard>
      )}

      {/* ── Two-column body ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">

        {/* Main — tabs */}
        <div className="min-w-0 flex-1">
          <NeuCard className="overflow-hidden rounded-2xl">
            <NeuTabs defaultValue={firstTab}>
              <div className="border-b border-[#c9c9c9] px-6 pt-5">
                <NeuTabList className="flex-wrap">
                  {tabs.map(({ value, label, icon: tabIcon, count, alert }) => (
                    <NeuTab key={value} value={value}
                      className="flex items-center gap-1.5 px-3 text-xs">
                      {tabIcon}{label}
                      {!!count && count > 0 && (
                        <span className="ml-1 rounded-full bg-[#e0e0e0] px-1.5 py-0.5 text-[10px] font-bold text-[#555] shadow-[inset_2px_2px_4px_#b8b8b8,inset_-2px_-2px_4px_#fff]">{count}</span>
                      )}
                        {alert && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-[#bf6e51]" />}
                    </NeuTab>
                  ))}
                </NeuTabList>
              </div>
              {tabs.map(({ value, content }) => (
                <NeuTabPanel key={value} value={value} className="p-6">
                  {content}
                </NeuTabPanel>
              ))}
            </NeuTabs>
          </NeuCard>
        </div>

        {/* Right rail — sticky */}
        <div className="w-full shrink-0 space-y-4 xl:w-72 xl:sticky xl:top-6">

          {/* Actions card */}
          {actions && (
            <NeuCard className="overflow-hidden rounded-2xl">
              {actions}
            </NeuCard>
          )}

          {/* Linked records */}
          {linkedRecords.length > 0 && (
            <NeuCard className="overflow-hidden rounded-2xl">
              <div className="border-b border-[#c9c9c9] px-5 py-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#666]">Linked Records</h3>
              </div>
              <div className="divide-y divide-[#c9c9c9]">
                {linkedRecords.map((lr, idx) => {
                  const t = LINKED_TINT[lr.tint ?? "slate"];
                  return (
                    <div key={idx} className="flex items-center gap-3 px-5 py-3.5">
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", t.bg, t.icon)}>
                        {lr.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-[#777]">{lr.label}</p>
                        <p className="truncate text-sm font-semibold text-[#333]">{lr.value}</p>
                        {lr.sub && <p className="truncate text-[11px] text-[#777]">{lr.sub}</p>}
                      </div>
                      {lr.href && (
                        <a href={lr.href}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e0e0e0] text-[#168d99] shadow-[-2px_-2px_5px_#fff,2px_2px_5px_#c1c1c1]">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </NeuCard>
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
    <div className="flex items-start justify-between gap-3 rounded-xl bg-[#e0e0e0] px-4 py-2.5 shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]">
      <span className="whitespace-nowrap text-xs font-medium text-[#777]">{label}</span>
      <span className="text-right text-xs font-semibold text-[#444]">{value ?? "—"}</span>
    </div>
  );
}

export function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#777]">{title}</h3>
      {children}
    </div>
  );
}

export function EmptyTab({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e0e0e0] text-[#888] shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#b8b8b8]">
        {icon}
      </div>
      <p className="text-sm font-medium text-[#666]">{label}</p>
    </div>
  );
}
