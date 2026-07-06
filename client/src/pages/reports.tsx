import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subMonths } from "date-fns";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Download,
  Clock,
  Users,
  Building2,
  Truck,
  DollarSign,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtShort(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return fmt(n);
}
function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? "")).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS = [
  { id: "aging",    label: "Aging",    icon: Clock       },
  { id: "agent",    label: "Agent",    icon: Users       },
  { id: "broker",   label: "Broker",   icon: Building2   },
  { id: "carrier",  label: "Carrier",  icon: Truck       },
  { id: "daily-ar", label: "Daily AR", icon: DollarSign  },
  { id: "monthly",  label: "Monthly",  icon: CalendarDays},
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Shared ───────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, color = "blue" }: { label: string; value: string; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    blue:  "bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400",
    green: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400",
    amber: "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400",
    red:   "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400",
    slate: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
  };
  return (
    <div className={cn("rounded-xl p-4 border border-white/50", colors[color])}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-[11px] opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

function DateRange({ start, end, onChange }: { start: string; end: string; onChange: (s: string, e: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input type="date" value={start} onChange={e => onChange(e.target.value, end)} className="h-8 text-xs w-36" />
      <span className="text-slate-400 text-xs">to</span>
      <Input type="date" value={end} onChange={e => onChange(start, e.target.value)} className="h-8 text-xs w-36" />
    </div>
  );
}

function SkeletonRows({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="animate-pulse">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3"><div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Aging ────────────────────────────────────────────────────────────────────

type AgingBuckets = Record<string, { count: number; total: number; carriers: Record<string, number>; brokers: Record<string, number> }>;

const BUCKET_CFG = {
  "0-30":  { bar: "bg-emerald-500", badge: "bg-emerald-100 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400", text: "text-emerald-700 dark:text-emerald-400" },
  "31-60": { bar: "bg-amber-400",   badge: "bg-amber-100 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400",             text: "text-amber-700 dark:text-amber-400" },
  "61-90": { bar: "bg-orange-500",  badge: "bg-orange-100 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400",        text: "text-orange-700 dark:text-orange-400" },
  "90+":   { bar: "bg-red-600",     badge: "bg-red-100 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400",                          text: "text-red-700 dark:text-red-400" },
} as const;
const BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;

function AgingTab() {
  const { data, isLoading } = useQuery<AgingBuckets>({ queryKey: ["/api/reports/aging"] });
  const grandTotal = data ? BUCKETS.reduce((s, b) => s + (data[b]?.total ?? 0), 0) : 0;

  const csvRows = useMemo(() => {
    if (!data) return [];
    return BUCKETS.flatMap(b =>
      Object.entries(data[b].carriers).map(([carrier, amt]) => ({ bucket: b, carrier, amount: amt.toFixed(2) }))
    );
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">Outstanding invoices grouped by days past due</p>
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv("aging_report.csv", csvRows)}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-3">{BUCKETS.map(b => <div key={b} className="h-32 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BUCKETS.map(b => {
              const bkt = data?.[b];
              const pct = grandTotal > 0 ? ((bkt?.total ?? 0) / grandTotal) * 100 : 0;
              const s = BUCKET_CFG[b];
              return (
                <div key={b} className={cn("rounded-xl border p-4", s.badge)}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold">{b} days</span>
                    <span className="text-[10px] font-medium opacity-60">{pct.toFixed(1)}%</span>
                  </div>
                  <p className="text-xl font-bold">{fmtShort(bkt?.total ?? 0)}</p>
                  <p className="text-[11px] opacity-70 mt-0.5">{bkt?.count ?? 0} invoices</p>
                  <div className="mt-2 h-1.5 rounded-full bg-black/10 dark:bg-white/10">
                    <div className={cn("h-1.5 rounded-full", s.bar)} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {BUCKETS.map(b => {
            const bkt = data?.[b];
            if (!bkt || bkt.count === 0) return null;
            const topCarriers = Object.entries(bkt.carriers).sort((a, z) => z[1] - a[1]).slice(0, 5);
            const topBrokers  = Object.entries(bkt.brokers ).sort((a, z) => z[1] - a[1]).slice(0, 5);
            return (
              <Card key={b} className="border border-slate-200 dark:border-slate-700">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className={cn("text-sm font-semibold flex items-center gap-2", BUCKET_CFG[b].text)}>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {b} days — {fmt(bkt.total)} across {bkt.count} invoices
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4 grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Top Carriers</p>
                    <div className="space-y-1">
                      {topCarriers.map(([name, amt]) => (
                        <div key={name} className="flex items-center justify-between text-xs">
                          <span className="text-slate-600 dark:text-slate-300 truncate max-w-[140px]">{name}</span>
                          <span className="font-semibold tabular-nums">{fmt(amt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Top Brokers</p>
                    <div className="space-y-1">
                      {topBrokers.map(([name, amt]) => (
                        <div key={name} className="flex items-center justify-between text-xs">
                          <span className="text-slate-600 dark:text-slate-300 truncate max-w-[140px]">{name}</span>
                          <span className="font-semibold tabular-nums">{fmt(amt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── Agent ────────────────────────────────────────────────────────────────────

type AgentRow = { agentId: string | null; agentName: string; count: number; totalFunded: number; totalAmount: number; avgDaysToFund: number | null };

function AgentTab() {
  const [start, setStart] = useState(format(subMonths(new Date(), 3), "yyyy-MM-dd"));
  const [end,   setEnd  ] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data = [], isLoading } = useQuery<AgentRow[]>({
    queryKey: ["/api/reports/agent", start, end],
    queryFn: () => fetch(`/api/reports/agent?startDate=${start}&endDate=${end}`).then(r => r.json()),
  });

  const sorted = [...data].sort((a, b) => b.totalFunded - a.totalFunded);
  const maxFunded = sorted[0]?.totalFunded ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <DateRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv("agent_report.csv", sorted.map(r => ({ agent: r.agentName, invoices: r.count, total_amount: r.totalAmount.toFixed(2), total_funded: r.totalFunded.toFixed(2), avg_days_to_fund: r.avgDaysToFund ?? "" })))}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>
      <Card className="border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              {["Agent", "Invoices", "Total Volume", "Total Funded", "Avg Days to Fund", "Funded %"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? <SkeletonRows cols={6} /> : sorted.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">No data for selected range.</td></tr>
            ) : sorted.map(row => {
              const pct = row.totalAmount > 0 ? (row.totalFunded / row.totalAmount) * 100 : 0;
              return (
                <tr key={row.agentId ?? "unassigned"} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-semibold text-slate-800 dark:text-white">{row.agentName}</td>
                  <td className="px-4 py-3 tabular-nums">{row.count}</td>
                  <td className="px-4 py-3 tabular-nums font-medium">{fmt(row.totalAmount)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700">
                        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${maxFunded > 0 ? (row.totalFunded / maxFunded) * 100 : 0}%` }} />
                      </div>
                      <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmt(row.totalFunded)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{row.avgDaysToFund != null ? `${row.avgDaysToFund}d` : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[11px] font-semibold px-1.5 py-0.5 rounded",
                      pct >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" :
                      pct >= 50 ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400" :
                                  "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                    )}>{pct.toFixed(0)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Broker ───────────────────────────────────────────────────────────────────

type BrokerRow = { debtorId: number | null; brokerName: string; invoiceCount: number; totalVolume: number; outstanding: number; paid: number; creditLimit: number | null; avgDaysToPay: number | null };

function BrokerTab() {
  const [start, setStart] = useState(format(subMonths(new Date(), 3), "yyyy-MM-dd"));
  const [end,   setEnd  ] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data = [], isLoading } = useQuery<BrokerRow[]>({
    queryKey: ["/api/reports/broker", start, end],
    queryFn: () => fetch(`/api/reports/broker?startDate=${start}&endDate=${end}`).then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <DateRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv("broker_report.csv", data.map(r => ({ broker: r.brokerName, invoices: r.invoiceCount, total_volume: r.totalVolume.toFixed(2), outstanding: r.outstanding.toFixed(2), paid: r.paid.toFixed(2), credit_limit: r.creditLimit ?? "", avg_days_to_pay: r.avgDaysToPay ?? "" })))}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>
      <Card className="border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              {["Broker", "Invoices", "Total Volume", "Outstanding", "Paid", "Credit Limit", "Avg Days to Pay"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? <SkeletonRows cols={7} /> : data.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">No data for selected range.</td></tr>
            ) : data.map(row => {
              const utilizationPct = row.creditLimit && row.creditLimit > 0 ? (row.outstanding / row.creditLimit) * 100 : null;
              return (
                <tr key={row.debtorId ?? "unknown"} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-semibold text-slate-800 dark:text-white">{row.brokerName}</td>
                  <td className="px-4 py-3 tabular-nums">{row.invoiceCount}</td>
                  <td className="px-4 py-3 tabular-nums font-medium">{fmt(row.totalVolume)}</td>
                  <td className="px-4 py-3">
                    <span className={cn("tabular-nums font-semibold", row.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400")}>{fmt(row.outstanding)}</span>
                    {utilizationPct != null && (
                      <div className="mt-1 w-16 h-1 rounded-full bg-slate-100 dark:bg-slate-700">
                        <div className={cn("h-1 rounded-full", utilizationPct > 80 ? "bg-red-500" : utilizationPct > 50 ? "bg-amber-400" : "bg-emerald-500")} style={{ width: `${Math.min(utilizationPct, 100)}%` }} />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">{fmt(row.paid)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-500">{row.creditLimit != null ? fmt(row.creditLimit) : "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{row.avgDaysToPay != null ? `${row.avgDaysToPay}d` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Carrier ──────────────────────────────────────────────────────────────────

type CarrierRow = { clientId: number; carrierName: string; invoiceCount: number; totalFunded: number; outstanding: number; avgInvoiceSize: number };

function CarrierTab() {
  const [start, setStart] = useState(format(subMonths(new Date(), 3), "yyyy-MM-dd"));
  const [end,   setEnd  ] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data = [], isLoading } = useQuery<CarrierRow[]>({
    queryKey: ["/api/reports/carrier", start, end],
    queryFn: () => fetch(`/api/reports/carrier?startDate=${start}&endDate=${end}`).then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <DateRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv("carrier_report.csv", data.map(r => ({ carrier: r.carrierName, invoices: r.invoiceCount, total_funded: r.totalFunded.toFixed(2), outstanding: r.outstanding.toFixed(2), avg_invoice: r.avgInvoiceSize.toFixed(2) })))}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>
      <Card className="border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              {["Carrier", "Invoices", "Total Funded", "Outstanding", "Avg Invoice Size"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? <SkeletonRows cols={5} /> : data.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">No data for selected range.</td></tr>
            ) : data.map(row => (
              <tr key={row.clientId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3 font-semibold text-slate-800 dark:text-white">{row.carrierName}</td>
                <td className="px-4 py-3 tabular-nums">{row.invoiceCount}</td>
                <td className="px-4 py-3 tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmt(row.totalFunded)}</td>
                <td className="px-4 py-3 tabular-nums text-amber-600 dark:text-amber-400 font-medium">{fmt(row.outstanding)}</td>
                <td className="px-4 py-3 tabular-nums text-slate-500">{fmt(row.avgInvoiceSize)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Daily AR ─────────────────────────────────────────────────────────────────

type DailyAR = { totalAR: number; outstanding: number; collectedToday: number; newToday: number; date: string };

function DailyARTab() {
  const { data, isLoading } = useQuery<DailyAR>({ queryKey: ["/api/reports/daily-ar"] });
  const collectRate = data && data.totalAR > 0 ? (data.collectedToday / data.totalAR) * 100 : 0;
  const csvRow = data ? [{ date: format(new Date(data.date), "yyyy-MM-dd"), total_ar: data.totalAR.toFixed(2), outstanding: data.outstanding.toFixed(2), collected_today: data.collectedToday.toFixed(2), new_today: data.newToday.toFixed(2) }] : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">Snapshot as of {format(new Date(), "MMMM d, yyyy")}</p>
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv("daily_ar.csv", csvRow)}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="Total AR"        value={fmtShort(data?.totalAR ?? 0)}        color="blue"  />
            <StatTile label="Outstanding"     value={fmtShort(data?.outstanding ?? 0)}    color="amber" />
            <StatTile label="Collected Today" value={fmtShort(data?.collectedToday ?? 0)} color="green" />
            <StatTile label="New Today"       value={fmtShort(data?.newToday ?? 0)}       color="slate" />
          </div>

          <Card className="border border-slate-200 dark:border-slate-700">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-600 dark:text-slate-300">Collection rate today</span>
                <span className={cn("font-bold text-lg", collectRate >= 10 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{collectRate.toFixed(2)}%</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-700">
                <div className={cn("h-3 rounded-full transition-all", collectRate >= 10 ? "bg-emerald-500" : "bg-amber-400")} style={{ width: `${Math.min(collectRate, 100)}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>{fmt(data?.collectedToday ?? 0)} collected</span>
                <span>{fmt(data?.totalAR ?? 0)} total AR</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Card className="border border-slate-200 dark:border-slate-700">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-2">
                  <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Collected today</p>
                  <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{fmt(data?.collectedToday ?? 0)}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border border-slate-200 dark:border-slate-700">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 p-2">
                  <TrendingDown className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Outstanding</p>
                  <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{fmt(data?.outstanding ?? 0)}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Monthly ──────────────────────────────────────────────────────────────────

type MonthRow = { month: number; label: string; invoiceCount: number; totalVolume: number; totalFees: number; totalAdvanced: number };
type MonthlyData = { year: number; months: MonthRow[] };

function MonthlyTab() {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading } = useQuery<MonthlyData>({
    queryKey: ["/api/reports/monthly", year],
    queryFn: () => fetch(`/api/reports/monthly?year=${year}`).then(r => r.json()),
  });

  const months = data?.months ?? [];
  const maxVol        = Math.max(...months.map(m => m.totalVolume), 1);
  const totalVol      = months.reduce((s, m) => s + m.totalVolume, 0);
  const totalFees     = months.reduce((s, m) => s + m.totalFees, 0);
  const totalAdvanced = months.reduce((s, m) => s + m.totalAdvanced, 0);
  const totalInvoices = months.reduce((s, m) => s + m.invoiceCount, 0);
  const curMonth      = new Date().getMonth() + 1;
  const curYear       = new Date().getFullYear();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setYear(y => y - 1)}>‹</Button>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 w-12 text-center">{year}</span>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setYear(y => y + 1)}>›</Button>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv(`monthly_${year}.csv`, months.map(m => ({ month: m.label, invoices: m.invoiceCount, volume: m.totalVolume.toFixed(2), advanced: m.totalAdvanced.toFixed(2), fees: m.totalFees.toFixed(2) })))}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatTile label="Total Volume"   value={fmtShort(totalVol)}      color="blue"  sub={String(year)} />
        <StatTile label="Total Advanced" value={fmtShort(totalAdvanced)} color="green" />
        <StatTile label="Total Fees"     value={fmtShort(totalFees)}     color="amber" />
        <StatTile label="Total Invoices" value={String(totalInvoices)}   color="slate" />
      </div>

      <Card className="border border-slate-200 dark:border-slate-700">
        <CardContent className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Monthly Volume — {year}</p>
          {isLoading ? (
            <div className="flex items-end gap-2 h-32">
              {Array.from({ length: 12 }).map((_, i) => <div key={i} className="flex-1 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" style={{ height: `${30 + Math.random() * 60}%` }} />)}
            </div>
          ) : (
            <div className="flex items-end gap-1.5 h-36">
              {months.map(m => {
                const pct = (m.totalVolume / maxVol) * 100;
                const isCur = m.month === curMonth && year === curYear;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="absolute bottom-6 hidden group-hover:flex bg-slate-800 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                      {m.label}: {fmtShort(m.totalVolume)}
                    </div>
                    <div
                      className={cn("w-full rounded-t transition-all", isCur ? "bg-blue-500" : m.totalVolume > 0 ? "bg-blue-300 dark:bg-blue-700" : "bg-slate-100 dark:bg-slate-800")}
                      style={{ height: `${Math.max(pct, m.totalVolume > 0 ? 4 : 2)}%` }}
                    />
                    <span className="text-[9px] text-slate-400">{m.label.slice(0, 3)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              {["Month", "Invoices", "Volume", "Advanced", "Fees", "Fee Rate"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? <SkeletonRows cols={6} rows={12} /> : months.map(m => {
              const feeRate = m.totalVolume > 0 ? (m.totalFees / m.totalVolume) * 100 : 0;
              const isCur = m.month === curMonth && year === curYear;
              return (
                <tr key={m.month} className={cn("hover:bg-slate-50 dark:hover:bg-slate-800/40", isCur && "font-semibold bg-blue-50/40 dark:bg-blue-950/10")}>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{m.label} {year}</td>
                  <td className="px-4 py-3 tabular-nums">{m.invoiceCount || "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{m.totalVolume > 0 ? fmt(m.totalVolume) : "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600 dark:text-emerald-400">{m.totalAdvanced > 0 ? fmt(m.totalAdvanced) : "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-blue-600 dark:text-blue-400">{m.totalFees > 0 ? fmt(m.totalFees) : "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-500">{m.totalVolume > 0 ? `${feeRate.toFixed(2)}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 font-semibold">
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">Total {year}</td>
              <td className="px-4 py-3 tabular-nums">{totalInvoices || "—"}</td>
              <td className="px-4 py-3 tabular-nums">{fmt(totalVol)}</td>
              <td className="px-4 py-3 tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(totalAdvanced)}</td>
              <td className="px-4 py-3 tabular-nums text-blue-600 dark:text-blue-400">{fmt(totalFees)}</td>
              <td className="px-4 py-3 tabular-nums text-slate-500">{totalVol > 0 ? `${((totalFees / totalVol) * 100).toFixed(2)}%` : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Reports() {
  const [activeTab, setActiveTab] = useState<TabId>("aging");

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Reports" subtitle="Financial reporting and analytics" />
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-5">

            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                  <BarChart3 className="h-6 w-6 text-blue-600" />
                  Reports
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Financial reporting and analytics</p>
              </div>
            </div>

            <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit flex-wrap">
              {TABS.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-all",
                      activeTab === tab.id
                        ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div>
              {activeTab === "aging"    && <AgingTab />}
              {activeTab === "agent"    && <AgentTab />}
              {activeTab === "broker"   && <BrokerTab />}
              {activeTab === "carrier"  && <CarrierTab />}
              {activeTab === "daily-ar" && <DailyARTab />}
              {activeTab === "monthly"  && <MonthlyTab />}
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}
