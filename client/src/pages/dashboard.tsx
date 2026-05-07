import { useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { FFBadge } from "@/components/ui/ff-badge";
import { FFEmpty } from "@/components/ui/ff-empty";
import TimeClock from "@/components/time-tracking/time-clock";
import type { Invoice, Activity, Exception } from "@shared/schema";
import { cn } from "@/lib/utils";
import {
  AlertCircle, ArrowRight, CheckCircle2, Clock3,
  FileText, DollarSign, ShieldAlert, FileX,
  Upload, UserPlus, Activity as ActivityIcon,
  TrendingUp, RotateCcw, ChevronRight,
  CircleSlash, Banknote, Eye, Zap,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | string) {
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtShort(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function getAgeDays(d: string | Date | null | undefined): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
}

function getAge(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  const ms = Date.now() - new Date(d).getTime();
  const h  = Math.floor(ms / 3_600_000);
  if (h < 1)  return "< 1h";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const m  = Math.floor(ms / 60_000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const FUNDED_STATUSES = new Set(["paid", "funded"]);
const QUEUE_STATUSES  = new Set(["submitted", "under_review", "approved"]);
const DOC_STATUSES    = new Set(["docs_pending"]);
const HOLD_STATUSES   = new Set(["rejected"]);

// ─── Activity icon map ────────────────────────────────────────────────────────

type ActivityConfig = { icon: typeof FileText; dot: string; label: string };

const ACTIVITY_MAP: Record<string, ActivityConfig> = {
  invoice_created:    { icon: FileText,      dot: "bg-blue-400",    label: "Invoice created"    },
  invoice_approved:   { icon: CheckCircle2,  dot: "bg-emerald-400", label: "Invoice approved"   },
  invoice_funded:     { icon: Banknote,      dot: "bg-emerald-400", label: "Invoice funded"     },
  invoice_rejected:   { icon: CircleSlash,   dot: "bg-red-400",     label: "Invoice rejected"   },
  document_uploaded:  { icon: Upload,        dot: "bg-blue-400",    label: "Document uploaded"  },
  client_created:     { icon: UserPlus,      dot: "bg-amber-400",   label: "Carrier added"      },
  exception_created:  { icon: AlertCircle,   dot: "bg-orange-400",  label: "Exception raised"   },
  exception_resolved: { icon: CheckCircle2,  dot: "bg-emerald-400", label: "Exception resolved" },
  activities_reset:   { icon: RotateCcw,     dot: "bg-slate-400",   label: "Activity reset"     },
};

function activityConfig(type: string): ActivityConfig {
  return ACTIVITY_MAP[type] ?? { icon: ActivityIcon, dot: "bg-slate-400", label: type };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({
  title, count, href, label = "View all",
}: { title: string; count?: number; href?: string; label?: string }) {
  const [, go] = useLocation();
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-slate-900 dark:text-white">{title}</span>
        {count !== undefined && (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {count}
          </span>
        )}
      </div>
      {href && (
        <button
          type="button"
          onClick={() => go(href)}
          className="flex items-center gap-0.5 text-[11.5px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          {label}
          <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "rounded-[14px] border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]",
      className
    )}>
      {children}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, go] = useLocation();

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: invoices    = [] } = useQuery<Invoice[]>({ queryKey: ["/api/invoices"] });
  const { data: activities  = [] } = useQuery<Activity[]>({ queryKey: ["/api/dashboard/recent-activities"] });
  const { data: exceptions  = [] } = useQuery<Exception[]>({ queryKey: ["/api/exceptions"] });
  const { data: stats } = useQuery<{
    pendingInvoices: number;
    processedToday: number;
    totalRevenue: string;
    activeClients: number;
  }>({ queryKey: ["/api/dashboard/stats"] });

  // ── Derived data ──────────────────────────────────────────────────────────

  const queueItems = useMemo(
    () => invoices
      .filter(i => QUEUE_STATUSES.has(i.status))
      .sort((a, b) => new Date(a.submittedAt ?? 0).getTime() - new Date(b.submittedAt ?? 0).getTime()),
    [invoices]
  );

  const docsItems    = useMemo(() => invoices.filter(i => DOC_STATUSES.has(i.status)), [invoices]);
  const heldItems    = useMemo(() => invoices.filter(i => HOLD_STATUSES.has(i.status)), [invoices]);
  const fundedItems  = useMemo(
    () => invoices
      .filter(i => FUNDED_STATUSES.has(i.status))
      .sort((a, b) => new Date(b.approvedAt ?? b.submittedAt ?? 0).getTime() - new Date(a.approvedAt ?? a.submittedAt ?? 0).getTime())
      .slice(0, 8),
    [invoices]
  );
  const openExceptions = useMemo(
    () => exceptions.filter(e => e.status === "open" || e.status === "under_review"),
    [exceptions]
  );

  const queueTotal = useMemo(
    () => queueItems.reduce((s, i) => s + Number(i.amount ?? 0), 0),
    [queueItems]
  );
  const fundedTotal = useMemo(
    () => fundedItems.reduce((s, i) => s + Number(i.amount ?? 0), 0),
    [fundedItems]
  );

  const approvedCount = useMemo(
    () => queueItems.filter(i => i.status === "approved").length,
    [queueItems]
  );
  const staleCount = useMemo(
    () => queueItems.filter(i => (getAgeDays(i.submittedAt) ?? 0) >= 2).length,
    [queueItems]
  );

  // ── Urgency tile config ───────────────────────────────────────────────────

  type Level = "neutral" | "info" | "warn" | "critical" | "positive";

  const tiles: {
    label: string; value: number; sub: string;
    href: string; level: Level; icon: typeof Clock3;
    pulse?: boolean;
  }[] = [
    {
      label: "In Queue",
      value: queueItems.length,
      sub: queueItems.length ? fmtShort(queueTotal) : "nothing pending",
      href: "/factoring",
      level: queueItems.length > 5 ? "warn" : queueItems.length > 0 ? "info" : "neutral",
      icon: Clock3,
    },
    {
      label: "Awaiting Docs",
      value: docsItems.length,
      sub: docsItems.length ? "need documentation" : "all clear",
      href: "/documents",
      level: docsItems.length > 0 ? "warn" : "neutral",
      icon: FileX,
      pulse: docsItems.length > 0,
    },
    {
      label: "Held Loads",
      value: heldItems.length,
      sub: heldItems.length ? "blocked from funding" : "none blocked",
      href: "/exceptions",
      level: heldItems.length > 0 ? "critical" : "neutral",
      icon: CircleSlash,
      pulse: heldItems.length > 0,
    },
    {
      label: "Open Exceptions",
      value: openExceptions.length,
      sub: openExceptions.length ? "need resolution" : "none open",
      href: "/exceptions",
      level: openExceptions.length > 0 ? "critical" : "neutral",
      icon: AlertCircle,
      pulse: openExceptions.length > 0,
    },
    {
      label: "Funded Today",
      value: stats?.processedToday ?? 0,
      sub: stats?.processedToday ? "loads advanced" : "no activity yet",
      href: "/factoring",
      level: "positive",
      icon: CheckCircle2,
    },
  ];

  const levelStyles: Record<Level, { tile: string; num: string; icon: string; pulse: string }> = {
    neutral:  {
      tile: "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))] hover:border-slate-300",
      num: "text-slate-800 dark:text-white", icon: "text-slate-400", pulse: "bg-slate-400",
    },
    info: {
      tile: "border-blue-200/60 bg-blue-50/40 dark:border-blue-900/40 dark:bg-blue-950/10 hover:bg-blue-50/70",
      num: "text-blue-700 dark:text-blue-300", icon: "text-blue-400", pulse: "bg-blue-400",
    },
    warn: {
      tile: "border-amber-200/60 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/10 hover:bg-amber-50/70",
      num: "text-amber-700 dark:text-amber-300", icon: "text-amber-400", pulse: "bg-amber-400",
    },
    critical: {
      tile: "border-red-200/60 bg-red-50/40 dark:border-red-900/40 dark:bg-red-950/10 hover:bg-red-50/70",
      num: "text-red-700 dark:text-red-300", icon: "text-red-400", pulse: "bg-red-500",
    },
    positive: {
      tile: "border-emerald-200/60 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/10 hover:bg-emerald-50/70",
      num: "text-emerald-700 dark:text-emerald-300", icon: "text-emerald-400", pulse: "bg-emerald-400",
    },
  };

  // ── Exception severity label ──────────────────────────────────────────────

  const sevClass = (s: string) => ({
    low:      "ff-badge ff-badge-draft",
    medium:   "ff-badge ff-badge-pending",
    high:     "ff-badge ff-badge-overdue",
    critical: "ff-badge ff-badge-rejected",
  }[s] ?? "ff-badge ff-badge-draft");

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell
      title="Dashboard"
      subtitle={`${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · Freight Operations Center`}
      group="Workspace"
    >
      {/* ── Today at a Glance ─────────────────────────────────────────────── */}
      <section className="mb-6">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">
          Today at a Glance
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map(tile => {
            const s = levelStyles[tile.level];
            const Icon = tile.icon;
            const showPulse = tile.pulse && tile.value > 0;
            return (
              <button
                key={tile.label}
                type="button"
                onClick={() => go(tile.href)}
                className={cn(
                  "group relative flex flex-col rounded-[12px] border p-4 text-left transition-all duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30",
                  s.tile
                )}
              >
                {showPulse && (
                  <span className="absolute right-3 top-3 flex h-2 w-2">
                    <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", s.pulse)} />
                    <span className={cn("relative inline-flex h-2 w-2 rounded-full", s.pulse)} />
                  </span>
                )}
                <div className="mb-3 flex items-start justify-between">
                  <Icon className={cn("h-[15px] w-[15px]", s.icon)} />
                  <ArrowRight className="h-3 w-3 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600" />
                </div>
                <div className={cn("text-[26px] font-bold leading-none tracking-tight", s.num)}>
                  {tile.value}
                </div>
                <div className="mt-1.5 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">
                  {tile.label}
                </div>
                <div className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500">
                  {tile.sub}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Action nudges (only when actionable items exist) ──────────────── */}
      {(approvedCount > 0 || staleCount > 0) && (
        <section className="mb-5 flex flex-wrap gap-2">
          {approvedCount > 0 && (
            <button
              type="button"
              onClick={() => go("/factoring")}
              className="flex items-center gap-2 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-[12px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300"
            >
              <Zap className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {approvedCount} load{approvedCount !== 1 ? "s" : ""} approved — ready to fund
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
          {staleCount > 0 && (
            <button
              type="button"
              onClick={() => go("/factoring")}
              className="flex items-center gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
            >
              <Clock3 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              {staleCount} item{staleCount !== 1 ? "s" : ""} sitting 2+ days in queue
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </section>
      )}

      {/* ── Main work area ────────────────────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">

        {/* ─ Funding Queue ─────────────────────────────────────────────── */}
        <Card className="p-4 lg:col-span-2">
          <SectionHeader
            title="Funding Queue"
            count={queueItems.length}
            href="/factoring"
          />

          {queueItems.length === 0 ? (
            <FFEmpty
              context="funding"
              size="sm"
              actions={[
                { label: "Go to Funding Queue", onClick: () => go("/factoring"), primary: true },
                { label: "Upload Documents", onClick: () => go("/documents") },
              ]}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ff-data-table w-full">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Load #</th>
                    <th className="text-right">Amount</th>
                    <th>Age</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {queueItems.slice(0, 10).map(inv => {
                    const ageDays = getAgeDays(inv.submittedAt);
                    const age = getAge(inv.submittedAt);
                    const isUrgent = (ageDays ?? 0) >= 3;
                    const isStale  = !isUrgent && (ageDays ?? 0) >= 2;
                    const isReady  = inv.status === "approved";
                    return (
                      <tr
                        key={inv.id}
                        className={cn(
                          isUrgent ? "ff-row-urgent" :
                          isStale  ? "ff-row-stale"  :
                          isReady  ? "ff-row-ready"  : ""
                        )}
                      >
                        <td className="font-mono text-[12px] font-semibold text-slate-800 dark:text-slate-200">
                          {inv.invoiceNumber}
                        </td>
                        <td className="text-slate-500 dark:text-slate-400">
                          {inv.loadNumber ?? (inv.loadId ? `#${inv.loadId}` : "—")}
                        </td>
                        <td className="text-right font-semibold text-slate-900 dark:text-white">
                          {fmt(inv.amount)}
                        </td>
                        <td>
                          {age ? (
                            <span className={cn(
                              "text-[11px] font-semibold",
                              isUrgent ? "text-red-600 dark:text-red-400" :
                              isStale  ? "text-amber-600 dark:text-amber-400" :
                              "text-slate-500 dark:text-slate-400"
                            )}>
                              {age}
                            </span>
                          ) : "—"}
                        </td>
                        <td>
                          <FFBadge status={inv.status} size="sm" />
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => go(`/invoices/${inv.id}`)}
                            className={cn(
                              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
                              isReady
                                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400"
                                : "bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/20 dark:text-blue-400"
                            )}
                          >
                            <Eye className="h-3 w-3" />
                            {isReady ? "Fund" : "Review"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {queueItems.length > 10 && (
                <div className="border-t border-slate-100 pt-2.5 text-center dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => go("/factoring")}
                    className="text-[11.5px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                  >
                    {queueItems.length - 10} more in queue →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Queue total */}
          {queueItems.length > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-[10px] bg-slate-50 px-3 py-2 dark:bg-slate-800/40">
              <div className="flex items-center gap-3 text-[11.5px] text-slate-500 dark:text-slate-400">
                <span>Total in queue</span>
                {approvedCount > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                    {approvedCount} approved
                  </span>
                )}
                {staleCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                    {staleCount} stale
                  </span>
                )}
              </div>
              <span className="text-[13px] font-semibold text-slate-900 dark:text-white">{fmt(queueTotal)}</span>
            </div>
          )}
        </Card>

        {/* ─ Recent Money Movement ────────────────────────────────────── */}
        <Card className="p-4">
          <SectionHeader title="Recent Funding" href="/factoring" />

          {fundedItems.length === 0 ? (
            <FFEmpty
              context="payouts"
              size="sm"
              actions={[{ label: "View Funding Queue", onClick: () => go("/factoring"), primary: true }]}
            />
          ) : (
            <div className="space-y-0.5">
              {fundedItems.map(inv => (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => go(`/invoices/${inv.id}`)}
                  className="group flex w-full items-center justify-between rounded-[9px] px-2.5 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11.5px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {inv.invoiceNumber}
                      </span>
                      <FFBadge status="funded" size="sm" />
                    </div>
                    <div className="text-[10.5px] text-slate-400 dark:text-slate-500 mt-0.5">
                      {timeAgo(inv.approvedAt ?? inv.submittedAt)}
                    </div>
                  </div>
                  <span className="ml-2 shrink-0 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400">
                    {fmt(inv.amount)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {fundedItems.length > 0 && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 dark:border-slate-800">
              <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wide font-semibold">
                Total shown
              </span>
              <span className="text-[12.5px] font-bold text-emerald-700 dark:text-emerald-400">
                {fmt(fundedTotal)}
              </span>
            </div>
          )}
        </Card>
      </div>

      {/* ── Bottom row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        {/* ─ Team Activity Feed ────────────────────────────────────────── */}
        <Card className="p-4">
          <SectionHeader title="Team Activity" count={activities.length} href="/audit-log" label="Full log" />

          {activities.length === 0 ? (
            <FFEmpty context="audit" size="sm" />
          ) : (
            <div className="space-y-0">
              {activities.slice(0, 10).map((act, i) => {
                const cfg = activityConfig(act.type);
                const Icon = cfg.icon;
                const isLast = i === Math.min(activities.length, 10) - 1;
                return (
                  <div key={act.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", cfg.dot)} />
                      {!isLast && <div className="mt-1 w-px flex-1 bg-slate-100 dark:bg-slate-800" />}
                    </div>

                    <div className={cn("min-w-0 pb-3", isLast && "pb-0")}>
                      <p className="text-[12.5px] leading-snug text-slate-700 dark:text-slate-300">
                        {act.description}
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500">
                        {timeAgo((act as any).createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ─ Exceptions + Time Clock ───────────────────────────────────── */}
        <div className="space-y-5">

          {/* Open Exceptions */}
          <Card className="p-4">
            <SectionHeader
              title="Open Exceptions"
              count={openExceptions.length}
              href="/exceptions"
            />

            {openExceptions.length === 0 ? (
              <FFEmpty context="exceptions" size="sm" />
            ) : (
              <div className="space-y-1.5">
                {openExceptions.slice(0, 5).map(exc => (
                  <button
                    key={exc.id}
                    type="button"
                    onClick={() => go("/exceptions")}
                    className="group flex w-full items-start justify-between gap-3 rounded-[9px] border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-slate-200 hover:bg-slate-50/80 dark:hover:border-slate-700 dark:hover:bg-slate-800/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-slate-800 dark:text-slate-200">
                        {exc.title}
                      </p>
                      {exc.entityRef && (
                        <p className="text-[10.5px] text-slate-400 dark:text-slate-500">
                          Ref: {exc.entityRef}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={sevClass(exc.severity)}>
                        {exc.severity}
                      </span>
                      <ChevronRight className="h-3 w-3 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                  </button>
                ))}

                {openExceptions.length > 5 && (
                  <button
                    type="button"
                    onClick={() => go("/exceptions")}
                    className="mt-1 w-full text-center text-[11.5px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                  >
                    {openExceptions.length - 5} more exceptions →
                  </button>
                )}
              </div>
            )}
          </Card>

          {/* Time Clock */}
          <TimeClock />
        </div>
      </div>

      {/* ── Held loads alert bar (only shown when items exist) ────────────── */}
      {heldItems.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => go("/exceptions")}
            className="flex w-full items-center justify-between rounded-[12px] border border-red-200/60 bg-red-50/50 px-4 py-3 text-left transition-colors hover:bg-red-50 dark:border-red-900/40 dark:bg-red-950/10"
          >
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-4 w-4 text-red-500" />
              <div>
                <span className="text-[13px] font-semibold text-red-800 dark:text-red-300">
                  {heldItems.length} load{heldItems.length !== 1 ? "s" : ""} currently held
                </span>
                <span className="ml-2 text-[12px] text-red-600/70 dark:text-red-400/70">
                  — rejected or blocked from funding
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[11.5px] font-medium text-red-600 dark:text-red-400">
              View held loads <ChevronRight className="h-3 w-3" />
            </div>
          </button>
        </div>
      )}
    </AppShell>
  );
}
