import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subMonths } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  FileText,
  ShieldCheck,
  Search,
  ChevronRight,
  X,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AgingPdfDownload } from "@/components/reports/aging-pdf-download";
import ChargebackReport from "@/components/reports/chargeback-report";
import AgingReport from "@/components/reports/aging-report";
import { CustomizeColumns, useReportColumns, type ReportColumn, type SavedTemplate } from "@/components/reports/report-customization";
import {
  Win95Tabs,
  Win95TabsList,
  Win95TabsTrigger,
} from "@/components/win95";
import { Link, useSearch } from "wouter";

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
  const safeCell = (value: unknown) => {
    const text = String(value ?? "");
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  };
  const csvCell = (value: unknown) => `"${safeCell(value).replace(/"/g, '""')}"`;
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map(r => headers.map(h => csvCell(r[h])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `Trucking_Pros_Financial_${filename}`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS = [
  { id: "global",   label: "Global Reports", icon: BarChart3 },
  { id: "aging",    label: "Aging",    icon: Clock       },
  { id: "agent",    label: "Agent",    icon: Users       },
  { id: "agent-performance", label: "Agent Performance", icon: TrendingUp },
  { id: "broker",   label: "Broker",   icon: Building2   },
  { id: "carrier",  label: "Carrier",  icon: Truck       },
  { id: "carrier-ar", label: "Carrier AR", icon: DollarSign },
  { id: "chargeback", label: "Chargeback", icon: FileText },
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
    <div className={cn("ff-card ff-reports-surface p-4", colors[color])}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#098b9f]">{value}</p>
      {sub && <p className="text-[11px] opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

function DateRange({ start, end, onChange }: { start: string; end: string; onChange: (s: string, e: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input type="date" value={start} onChange={e => onChange(e.target.value, end)} className="ff-input h-8 text-xs w-36" />
      <span className="text-slate-400 text-xs">to</span>
      <Input type="date" value={end} onChange={e => onChange(start, e.target.value)} className="ff-input h-8 text-xs w-36" />
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

// ─── Agent ────────────────────────────────────────────────────────────────────

type AgentRow = { agentId: string | null; agentName: string; count: number; totalFunded: number; totalAmount: number; avgDaysToFund: number | null };

function AgentTab() {
  const [start, setStart] = useState(format(subMonths(new Date(), 3), "yyyy-MM-dd"));
  const [end,   setEnd  ] = useState(format(new Date(), "yyyy-MM-dd"));
  const { user } = useAuth();
  const columns: ReportColumn[] = [
    { key: "agent", label: "Agent" }, { key: "invoices", label: "Invoices" }, { key: "totalAmount", label: "Total volume" },
    { key: "totalFunded", label: "Total funded" }, { key: "avgDaysToFund", label: "Avg days to fund" }, { key: "fundedPct", label: "Funded %" },
  ];
  const prefs = useReportColumns("agent", user?.id, columns, { start, end });
  const applyTemplate = (template: SavedTemplate) => {
    const filters = prefs.applyTemplate(template);
    if (filters.start) setStart(filters.start);
    if (filters.end) setEnd(filters.end);
  };

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
        <div className="flex gap-2"><CustomizeColumns columns={columns} visible={prefs.visible} onChange={prefs.setVisible} templates={prefs.templates} onSave={prefs.saveTemplate} onApply={applyTemplate} onDelete={prefs.deleteTemplate} />
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv("agent_report.csv", sorted.map(r => {
          const pct = r.totalAmount > 0 ? (r.totalFunded / r.totalAmount) * 100 : 0;
          const values: Record<string, unknown> = { agent: r.agentName, invoices: r.count, totalAmount: r.totalAmount.toFixed(2), totalFunded: r.totalFunded.toFixed(2), avgDaysToFund: r.avgDaysToFund ?? "", fundedPct: `${pct.toFixed(0)}%` };
          return Object.fromEntries(columns.filter(c => prefs.visible.includes(c.key)).map(c => [c.label, values[c.key]]));
        }))}>
          <Download className="h-3.5 w-3.5" /> Export visible
        </Button></div>
      </div>
      <Card className="border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="ff-data-table w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              {columns.filter(c => prefs.visible.includes(c.key)).map(c => (
                <th key={c.key} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? <SkeletonRows cols={prefs.visible.length} /> : sorted.length === 0 ? (
              <tr><td colSpan={prefs.visible.length} className="px-4 py-12 text-center text-sm text-slate-400">No data for selected range.</td></tr>
            ) : sorted.map(row => {
              const pct = row.totalAmount > 0 ? (row.totalFunded / row.totalAmount) * 100 : 0;
              return (
                <tr key={row.agentId ?? "unassigned"} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  {prefs.visible.includes("agent") && <td className="px-4 py-3 font-semibold text-slate-800 dark:text-white">{row.agentName}</td>}
                  {prefs.visible.includes("invoices") && <td className="px-4 py-3 tabular-nums">{row.count}</td>}
                  {prefs.visible.includes("totalAmount") && <td className="px-4 py-3 tabular-nums font-medium">{fmt(row.totalAmount)}</td>}
                  {prefs.visible.includes("totalFunded") && <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700">
                        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${maxFunded > 0 ? (row.totalFunded / maxFunded) * 100 : 0}%` }} />
                      </div>
                      <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmt(row.totalFunded)}</span>
                    </div>
                  </td>}
                  {prefs.visible.includes("avgDaysToFund") && <td className="px-4 py-3 tabular-nums">{row.avgDaysToFund != null ? `${row.avgDaysToFund}d` : "—"}</td>}
                  {prefs.visible.includes("fundedPct") && <td className="px-4 py-3">
                    <span className={cn("text-[11px] font-semibold px-1.5 py-0.5 rounded",
                      pct >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" :
                      pct >= 50 ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400" :
                                  "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                    )}>{pct.toFixed(0)}%</span>
                  </td>}
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

type BrokerRow = { brokerId: number | null; debtorId: number | null; brokerName: string; invoiceCount: number; totalVolume: number; outstanding: number; paid: number; creditLimit: number | null; avgDaysToPay: number | null };

function BrokerTab() {
  const [start, setStart] = useState(format(subMonths(new Date(), 3), "yyyy-MM-dd"));
  const [end,   setEnd  ] = useState(format(new Date(), "yyyy-MM-dd"));
  const { user } = useAuth();
  const columns: ReportColumn[] = [
    { key: "brokerName", label: "Broker" }, { key: "invoiceCount", label: "Invoices" }, { key: "totalVolume", label: "Total volume" },
    { key: "outstanding", label: "Outstanding" }, { key: "paid", label: "Paid" }, { key: "creditLimit", label: "Credit limit" }, { key: "avgDaysToPay", label: "Avg days to pay" },
  ];
  const prefs = useReportColumns("broker", user?.id, columns, { start, end });
  const applyTemplate = (template: SavedTemplate) => { const f = prefs.applyTemplate(template); if (f.start) setStart(f.start); if (f.end) setEnd(f.end); };

  const { data = [], isLoading } = useQuery<BrokerRow[]>({
    queryKey: ["/api/reports/broker", start, end],
    queryFn: () => fetch(`/api/reports/broker?startDate=${start}&endDate=${end}`).then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <DateRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
        <div className="flex gap-2"><CustomizeColumns columns={columns} visible={prefs.visible} onChange={prefs.setVisible} templates={prefs.templates} onSave={prefs.saveTemplate} onApply={applyTemplate} onDelete={prefs.deleteTemplate} />
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv("broker_report.csv", data.map(r => {
          const values: Record<string, unknown> = { brokerName: r.brokerName, invoiceCount: r.invoiceCount, totalVolume: r.totalVolume.toFixed(2), outstanding: r.outstanding.toFixed(2), paid: r.paid.toFixed(2), creditLimit: r.creditLimit ?? "", avgDaysToPay: r.avgDaysToPay ?? "" };
          return Object.fromEntries(columns.filter(c => prefs.visible.includes(c.key)).map(c => [c.label, values[c.key]]));
        }))}>
          <Download className="h-3.5 w-3.5" /> Export visible
        </Button></div>
      </div>
      <Card className="border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="ff-data-table w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              {columns.filter(c => prefs.visible.includes(c.key)).map(c => (
                <th key={c.key} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? <SkeletonRows cols={prefs.visible.length} /> : data.length === 0 ? (
              <tr><td colSpan={prefs.visible.length} className="px-4 py-12 text-center text-sm text-slate-400">No data for selected range.</td></tr>
            ) : data.map((row, index) => {
              const utilizationPct = row.creditLimit && row.creditLimit > 0 ? (row.outstanding / row.creditLimit) * 100 : null;
              return (
                <tr key={`${row.debtorId ?? "unknown"}-${index}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  {prefs.visible.includes("brokerName") && <td className="px-4 py-3 font-semibold text-slate-800 dark:text-white">{row.brokerName}</td>}
                  {prefs.visible.includes("invoiceCount") && <td className="px-4 py-3 tabular-nums">{row.invoiceCount}</td>}
                  {prefs.visible.includes("totalVolume") && <td className="px-4 py-3 tabular-nums font-medium">{fmt(row.totalVolume)}</td>}
                  {prefs.visible.includes("outstanding") && <td className="px-4 py-3">
                    <span className={cn("tabular-nums font-semibold", row.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400")}>{fmt(row.outstanding)}</span>
                    {utilizationPct != null && (
                      <div className="mt-1 w-16 h-1 rounded-full bg-slate-100 dark:bg-slate-700">
                        <div className={cn("h-1 rounded-full", utilizationPct > 80 ? "bg-red-500" : utilizationPct > 50 ? "bg-amber-400" : "bg-emerald-500")} style={{ width: `${Math.min(utilizationPct, 100)}%` }} />
                      </div>
                    )}
                  </td>}
                  {prefs.visible.includes("paid") && <td className="px-4 py-3 tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">{fmt(row.paid)}</td>}
                  {prefs.visible.includes("creditLimit") && <td className="px-4 py-3 tabular-nums text-slate-500">{row.creditLimit != null ? fmt(row.creditLimit) : "—"}</td>}
                  {prefs.visible.includes("avgDaysToPay") && <td className="px-4 py-3 tabular-nums">{row.avgDaysToPay != null ? `${row.avgDaysToPay}d` : "—"}</td>}
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
  const { user } = useAuth();
  const columns: ReportColumn[] = [
    { key: "carrierName", label: "Carrier" }, { key: "invoiceCount", label: "Invoices" }, { key: "totalFunded", label: "Total funded" },
    { key: "outstanding", label: "Outstanding" }, { key: "avgInvoiceSize", label: "Avg invoice size" },
  ];
  const prefs = useReportColumns("carrier", user?.id, columns, { start, end });
  const applyTemplate = (template: SavedTemplate) => { const f = prefs.applyTemplate(template); if (f.start) setStart(f.start); if (f.end) setEnd(f.end); };

  const { data = [], isLoading } = useQuery<CarrierRow[]>({
    queryKey: ["/api/reports/carrier", start, end],
    queryFn: () => fetch(`/api/reports/carrier?startDate=${start}&endDate=${end}`).then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <DateRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
        <div className="flex gap-2"><CustomizeColumns columns={columns} visible={prefs.visible} onChange={prefs.setVisible} templates={prefs.templates} onSave={prefs.saveTemplate} onApply={applyTemplate} onDelete={prefs.deleteTemplate} />
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv("carrier_report.csv", data.map(r => {
          const values: Record<string, unknown> = { carrierName: r.carrierName, invoiceCount: r.invoiceCount, totalFunded: r.totalFunded.toFixed(2), outstanding: r.outstanding.toFixed(2), avgInvoiceSize: r.avgInvoiceSize.toFixed(2) };
          return Object.fromEntries(columns.filter(c => prefs.visible.includes(c.key)).map(c => [c.label, values[c.key]]));
        }))}>
          <Download className="h-3.5 w-3.5" /> Export visible
        </Button></div>
      </div>
      <Card className="border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="ff-data-table w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              {columns.filter(c => prefs.visible.includes(c.key)).map(c => (
                <th key={c.key} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? <SkeletonRows cols={prefs.visible.length} /> : data.length === 0 ? (
              <tr><td colSpan={prefs.visible.length} className="px-4 py-12 text-center text-sm text-slate-400">No data for selected range.</td></tr>
            ) : data.map(row => (
              <tr key={row.clientId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                {prefs.visible.includes("carrierName") && <td className="px-4 py-3 font-semibold text-slate-800 dark:text-white">{row.carrierName}</td>}
                {prefs.visible.includes("invoiceCount") && <td className="px-4 py-3 tabular-nums">{row.invoiceCount}</td>}
                {prefs.visible.includes("totalFunded") && <td className="px-4 py-3 tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmt(row.totalFunded)}</td>}
                {prefs.visible.includes("outstanding") && <td className="px-4 py-3 tabular-nums text-amber-600 dark:text-amber-400 font-medium">{fmt(row.outstanding)}</td>}
                {prefs.visible.includes("avgInvoiceSize") && <td className="px-4 py-3 tabular-nums text-slate-500">{fmt(row.avgInvoiceSize)}</td>}
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
  const { user } = useAuth();
  const { data, isLoading } = useQuery<DailyAR>({ queryKey: ["/api/reports/daily-ar"] });
  const columns: ReportColumn[] = [{ key: "date", label: "Date" }, { key: "totalAR", label: "Total AR" }, { key: "outstanding", label: "Outstanding" }, { key: "collectedToday", label: "Collected today" }, { key: "newToday", label: "New today" }];
  const prefs = useReportColumns("daily-ar", user?.id, columns, {});
  const applyTemplate = (template: SavedTemplate) => { prefs.applyTemplate(template); };
  const collectRate = data && data.totalAR > 0 ? (data.collectedToday / data.totalAR) * 100 : 0;
  const csvRow = data ? [Object.fromEntries(columns.filter(c => prefs.visible.includes(c.key)).map(c => [c.label, ({
    date: format(new Date(data.date), "yyyy-MM-dd"), totalAR: data.totalAR.toFixed(2), outstanding: data.outstanding.toFixed(2),
    collectedToday: data.collectedToday.toFixed(2), newToday: data.newToday.toFixed(2),
  } as Record<string, string>)[c.key]]))] : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">Snapshot as of {format(new Date(), "MMMM d, yyyy")}</p>
        <div className="flex gap-2"><CustomizeColumns columns={columns} visible={prefs.visible} onChange={prefs.setVisible} templates={prefs.templates} onSave={prefs.saveTemplate} onApply={applyTemplate} onDelete={prefs.deleteTemplate} />
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv("daily_ar.csv", csvRow)}>
          <Download className="h-3.5 w-3.5" /> Export visible
        </Button></div>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="ff-reports-surface h-28 bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {prefs.visible.includes("totalAR") && <StatTile label="Total AR" value={fmtShort(data?.totalAR ?? 0)} color="blue" />}
            {prefs.visible.includes("outstanding") && <StatTile label="Outstanding" value={fmtShort(data?.outstanding ?? 0)} color="amber" />}
            {prefs.visible.includes("collectedToday") && <StatTile label="Collected Today" value={fmtShort(data?.collectedToday ?? 0)} color="green" />}
            {prefs.visible.includes("newToday") && <StatTile label="New Today" value={fmtShort(data?.newToday ?? 0)} color="slate" />}
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

          {(prefs.visible.includes("collectedToday") || prefs.visible.includes("outstanding")) && <div className="grid grid-cols-2 gap-3">
            {prefs.visible.includes("collectedToday") && <Card className="border border-slate-200 dark:border-slate-700">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-2">
                  <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Collected today</p>
                  <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{fmt(data?.collectedToday ?? 0)}</p>
                </div>
              </CardContent>
            </Card>}
            {prefs.visible.includes("outstanding") && <Card className="border border-slate-200 dark:border-slate-700">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 p-2">
                  <TrendingDown className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Outstanding</p>
                  <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{fmt(data?.outstanding ?? 0)}</p>
                </div>
              </CardContent>
            </Card>}
          </div>}
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
  const { user } = useAuth();
  const columns: ReportColumn[] = [{ key: "label", label: "Month" }, { key: "invoiceCount", label: "Invoices" }, { key: "totalVolume", label: "Volume" }, { key: "totalAdvanced", label: "Advanced" }, { key: "totalFees", label: "Fees" }, { key: "feeRate", label: "Fee rate" }];
  const prefs = useReportColumns("monthly", user?.id, columns, { year: String(year) });
  const applyTemplate = (template: SavedTemplate) => { const f = prefs.applyTemplate(template); if (f.year && /^\d{4}$/.test(f.year)) setYear(Number(f.year)); };

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
        <div className="flex gap-2"><CustomizeColumns columns={columns} visible={prefs.visible} onChange={prefs.setVisible} templates={prefs.templates} onSave={prefs.saveTemplate} onApply={applyTemplate} onDelete={prefs.deleteTemplate} />
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCsv(`monthly_${year}.csv`, months.map(m => {
          const values: Record<string, unknown> = { label: m.label, invoiceCount: m.invoiceCount, totalVolume: m.totalVolume.toFixed(2), totalAdvanced: m.totalAdvanced.toFixed(2), totalFees: m.totalFees.toFixed(2), feeRate: m.totalVolume > 0 ? `${((m.totalFees / m.totalVolume) * 100).toFixed(2)}%` : "" };
          return Object.fromEntries(columns.filter(c => prefs.visible.includes(c.key)).map(c => [c.label, values[c.key]]));
        }))}>
          <Download className="h-3.5 w-3.5" /> Export visible
        </Button></div>
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
        <table className="ff-data-table w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              {columns.filter(c => prefs.visible.includes(c.key)).map(c => (
                <th key={c.key} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? <SkeletonRows cols={prefs.visible.length} rows={12} /> : months.map(m => {
              const feeRate = m.totalVolume > 0 ? (m.totalFees / m.totalVolume) * 100 : 0;
              const isCur = m.month === curMonth && year === curYear;
              return (
                <tr key={m.month} className={cn("hover:bg-slate-50 dark:hover:bg-slate-800/40", isCur && "font-semibold bg-blue-50/40 dark:bg-blue-950/10")}>
                  {prefs.visible.includes("label") && <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{m.label} {year}</td>}
                  {prefs.visible.includes("invoiceCount") && <td className="px-4 py-3 tabular-nums">{m.invoiceCount || "—"}</td>}
                  {prefs.visible.includes("totalVolume") && <td className="px-4 py-3 tabular-nums">{m.totalVolume > 0 ? fmt(m.totalVolume) : "—"}</td>}
                  {prefs.visible.includes("totalAdvanced") && <td className="px-4 py-3 tabular-nums text-emerald-600 dark:text-emerald-400">{m.totalAdvanced > 0 ? fmt(m.totalAdvanced) : "—"}</td>}
                  {prefs.visible.includes("totalFees") && <td className="px-4 py-3 tabular-nums text-blue-600 dark:text-blue-400">{m.totalFees > 0 ? fmt(m.totalFees) : "—"}</td>}
                  {prefs.visible.includes("feeRate") && <td className="px-4 py-3 tabular-nums text-slate-500">{m.totalVolume > 0 ? `${feeRate.toFixed(2)}%` : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 font-semibold">
                  {prefs.visible.includes("label") && <td className="px-4 py-3 text-slate-700 dark:text-slate-200">Total {year}</td>}
                  {prefs.visible.includes("invoiceCount") && <td className="px-4 py-3 tabular-nums">{totalInvoices || "—"}</td>}
                  {prefs.visible.includes("totalVolume") && <td className="px-4 py-3 tabular-nums">{fmt(totalVol)}</td>}
                  {prefs.visible.includes("totalAdvanced") && <td className="px-4 py-3 tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(totalAdvanced)}</td>}
                  {prefs.visible.includes("totalFees") && <td className="px-4 py-3 tabular-nums text-blue-600 dark:text-blue-400">{fmt(totalFees)}</td>}
                  {prefs.visible.includes("feeRate") && <td className="px-4 py-3 tabular-nums text-slate-500">{totalVol > 0 ? `${((totalFees / totalVol) * 100).toFixed(2)}%` : "—"}</td>}
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
}

// ─── Agent performance / Carrier AR ──────────────────────────────────────────

type PerformanceRow = {
  userId?: string; id?: string; firstName?: string; lastName?: string; email?: string; role?: string;
  invoicesProcessed?: number; invoiceCount?: number; fundedVolume?: number; totalVolumeFunded?: number; totalFunded?: number;
  averageDaysToFund?: number | null; avgDaysToFund?: number | null; carrierReviewsCompleted?: number;
  brokerReviewsCompleted?: number; hoursWorked?: number; clockHoursWorked?: number; invoicesByStage?: Record<string, number>;
  invoices?: Array<Record<string, unknown>>;
};
type Warning = { id: number; userId: string; agentName?: string; firstName?: string; lastName?: string; reason: string; severity: string; createdAt: string; acknowledgedAt?: string | null };
type WarningDraft = { userId: string; severity: string; reason: string };
const emptyWarningDraft = (): WarningDraft => ({ userId: "", severity: "verbal", reason: "" });

// Honor TanStack cancellation so old agent/date requests cannot complete into
// a new view. HTTP failures must not be interpreted as successful report rows.
async function fetchPerformanceJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(`${response.status}: Expected JSON from ${url.split("?")[0]}`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.message || "Unable to load report"}`);
  return data as T;
}
type ArRow = {
  carrierId?: number; brokerId?: number; id?: number; carrierName?: string; brokerName?: string;
  totalInvoices?: number; invoiceCount?: number; totalFundedAmount?: number; totalFunded?: number;
  totalOutstanding?: number; outstanding?: number; reserveHeld?: number; totalReserve?: number;
  totalCollected?: number; collected?: number; chargebackExposure?: number;
  aging?: Record<string, number>; invoices?: Array<Record<string, unknown>>;
};
type ArResponse = { totals: { totalOutstanding: number; reserveHeld: number; totalCollected: number; chargebackExposure: number }; results: ArRow[] };
const money = (row: ArRow, ...keys: string[]) => Number(keys.map(k => (row as Record<string, unknown>)[k]).find(v => v != null) ?? 0);
const arValue = (row: ArRow, bucket: string) => Number(row.aging?.[bucket] ?? (row as Record<string, unknown>)[bucket] ?? 0);

function ReportToolbar({ start, end, onDates, children }: { start: string; end: string; onDates: (s: string, e: string) => void; children?: ReactNode }) {
  return <div className="ff-card ff-reports-surface flex flex-wrap items-end justify-between gap-3 p-3">
    <div className="flex flex-wrap items-end gap-2">
      <div><label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label><Input type="date" value={start} onChange={e => onDates(e.target.value, end)} className="h-8 w-36 text-xs" /></div>
      <span className="mb-2 text-xs text-slate-400">to</span>
      <div><label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Through</label><Input type="date" value={end} onChange={e => onDates(start, e.target.value)} className="h-8 w-36 text-xs" /></div>
      {children}
    </div>
  </div>;
}

function InvoiceDrilldown({ open, onOpenChange, title, invoices }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; invoices?: Array<Record<string, unknown>> }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="ff-reports-surface max-w-4xl overflow-hidden p-0">
    <DialogHeader className="border-b border-slate-200 px-6 py-5 dark:border-slate-700"><DialogTitle>{title}</DialogTitle><DialogDescription>Invoice activity for the selected reporting period.</DialogDescription></DialogHeader>
    <div className="max-h-[60vh] overflow-auto p-6">
      {!invoices?.length ? <div className="py-12 text-center text-sm text-slate-500">No invoice detail was returned for this selection.</div> :
        <div className="overflow-x-auto"><table className="ff-data-table w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-[10px] uppercase tracking-wider text-slate-500">{["Invoice","Status","Amount","Funded","Date"].map(h => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody className="divide-y">{invoices.map((inv, i) => <tr key={String(inv.id ?? i)}><td className="px-3 py-2 font-semibold">{String(inv.invoiceNumber ?? inv.number ?? inv.id ?? "—")}</td><td className="px-3 py-2">{String(inv.status ?? "—")}</td><td className="px-3 py-2 tabular-nums">{inv.amount != null ? fmt(Number(inv.amount)) : "—"}</td><td className="px-3 py-2 tabular-nums">{inv.fundedAmount != null ? fmt(Number(inv.fundedAmount)) : "—"}</td><td className="px-3 py-2">{String(inv.createdAt ?? inv.date ?? "—")}</td></tr>)}</tbody>
        </table></div>}
    </div>
  </DialogContent></Dialog>;
}

function AgentPerformanceTab() {
  const [filters, setFilters] = useState(() => ({
    start: format(subMonths(new Date(), 3), "yyyy-MM-dd"),
    end: format(new Date(), "yyyy-MM-dd"), agentId: "all", revision: 0,
  }));
  const { start, end, agentId, revision } = filters;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const contextKey = JSON.stringify([user?.id, user?.role, agentId, start, end, revision]);
  const activeContext = useRef(contextKey);
  activeContext.current = contextKey;
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningForm, setWarningForm] = useState<WarningDraft>(emptyWarningDraft);
  const [warningSession, setWarningSession] = useState(0);
  const [pendingAcknowledgements, setPendingAcknowledgements] = useState<Set<number>>(() => new Set());
  const activeWarningSession = useRef(warningSession);
  activeWarningSession.current = warningSession;
  const manager = user?.role === "manager" || user?.role === "admin";
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const rangeError = !validDate(start) || !validDate(end) ? "Choose a valid From and Through date."
    : start > end ? "From date must be on or before Through date." : null;
  const enabled = !!user?.id && !rangeError;
  const params = new URLSearchParams({ startDate: start, endDate: end });
  if (agentId !== "all") params.set("userId", agentId);
  const performancePrefix = ["/api/reports/agent-performance", user?.id, user?.role] as const;
  const warningPrefix = ["/api/warnings", user?.id, user?.role] as const;
  const freshness = { enabled, staleTime: 0, gcTime: 0, refetchOnMount: "always" as const, placeholderData: undefined };
  const query = useQuery<PerformanceRow[] | PerformanceRow>({
    ...freshness, queryKey: [...performancePrefix, start, end, agentId, revision],
    queryFn: ({ signal }) => fetchPerformanceJson(`/api/reports/agent-performance?${params}`, signal),
  });
  const agentOptionsQuery = useQuery<PerformanceRow[]>({
    ...freshness, queryKey: [...performancePrefix, start, end, "options", revision],
    queryFn: ({ signal }) => fetchPerformanceJson(`/api/reports/agent-performance?${new URLSearchParams({ startDate: start, endDate: end })}`, signal),
  });
  const warningQuery = useQuery<Warning[]>({
    ...freshness, queryKey: [...warningPrefix, start, end, agentId, revision],
    // Warnings are personnel history, not period metrics; filter by employee
    // without discarding historical warnings outside the performance period.
    queryFn: ({ signal }) => fetchPerformanceJson(`/api/warnings${agentId === "all" ? "" : `?${new URLSearchParams({ userId: agentId })}`}`, signal),
  });
  const reportReady = enabled && query.isSuccess && !query.isFetching;
  const optionsReady = enabled && agentOptionsQuery.isSuccess && !agentOptionsQuery.isFetching;
  const agentOptions = optionsReady && Array.isArray(agentOptionsQuery.data) ? agentOptionsQuery.data : [];
  const rows = reportReady ? (Array.isArray(query.data) ? query.data : query.data ? [query.data] : []) : [];
  const selected = rows.find(row => String(row.userId ?? row.id) === selectedAgentId) ?? null;
  const warnings = enabled && warningQuery.isSuccess && !warningQuery.isFetching ? warningQuery.data : [];
  const clearWarning = () => { setWarningOpen(false); setWarningForm(emptyWarningDraft()); };
  const createWarning = useMutation({
    mutationFn: ({ draft }: { draft: WarningDraft; context: string; session: number }) => apiRequest("POST", "/api/warnings", draft),
    onSuccess: (_response, variables) => {
      // A save initiated under A must not close/erase a newer draft under B.
      if (variables.context === activeContext.current && variables.session === activeWarningSession.current) clearWarning();
      void queryClient.invalidateQueries({ queryKey: ["/api/warnings"] });
    },
  });
  const acknowledge = useMutation({
    mutationFn: ({ id }: { id: number; context: string }) => apiRequest("PATCH", `/api/warnings/${id}/acknowledge`),
    onMutate: ({ id, context }) => {
      if (context === activeContext.current) setPendingAcknowledgements(previous => new Set(previous).add(id));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/warnings"] }),
    onSettled: (_response, _error, { id, context }) => {
      if (context === activeContext.current) setPendingAcknowledgements(previous => { const next = new Set(previous); next.delete(id); return next; });
    },
  });
  const resetDetail = () => {
    setSelectedAgentId(null);
    setAgentMenuOpen(false);
    clearWarning();
    createWarning.reset();
    acknowledge.reset();
    setPendingAcknowledgements(new Set());
    activeWarningSession.current += 1;
    setWarningSession(activeWarningSession.current);
  };
  const changeFilters = (patch: Partial<Pick<typeof filters, "agentId" | "start" | "end">>) => {
    const current = filtersRef.current;
    if (Object.entries(patch).every(([name, value]) => current[name as keyof typeof filters] === value)) return;
    const next = { ...current, ...patch, revision: current.revision + 1 };
    filtersRef.current = next;
    activeContext.current = JSON.stringify([user?.id, user?.role, next.agentId, next.start, next.end, next.revision]);
    resetDetail();
    // Mark both old and previously visited contexts stale without starting a
    // redundant fetch for the context we are leaving. New revision keys fetch fresh.
    for (const prefix of [performancePrefix, warningPrefix]) {
      void queryClient.cancelQueries({ queryKey: prefix });
      void queryClient.invalidateQueries({ queryKey: prefix, refetchType: "none" });
    }
    setFilters(next);
  };
  const onAgentChange = (id: string) => changeFilters({ agentId: id });
  const performanceColumns: ReportColumn[] = [
    { key: "agent", label: "Agent" }, { key: "role", label: "Role" }, { key: "invoices", label: "Invoices" },
    { key: "volume_funded", label: "Volume funded" }, { key: "avg_days_to_fund", label: "Avg days" }, { key: "reviews", label: "Reviews" }, { key: "hours", label: "Hours" },
  ];
  const reportPrefs = useReportColumns("agent-performance", user?.id, performanceColumns, { start, end, agentId });
  const applyReportTemplate = (template: SavedTemplate) => {
    const saved = reportPrefs.applyTemplate(template);
    changeFilters({ start: saved.start ?? start, end: saved.end ?? end, agentId: saved.agentId ?? agentId });
  };
  const csv = rows.map(r => {
    const values: Record<string, unknown> = {
      agent: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email || "—", role: r.role ?? "",
      invoices: r.invoicesProcessed ?? r.invoiceCount ?? 0, volume_funded: r.fundedVolume ?? r.totalVolumeFunded ?? r.totalFunded ?? 0,
      avg_days_to_fund: r.averageDaysToFund ?? r.avgDaysToFund ?? "",
      reviews: Number(r.carrierReviewsCompleted ?? 0) + Number(r.brokerReviewsCompleted ?? 0), hours: r.hoursWorked ?? r.clockHoursWorked ?? 0,
    };
    return Object.fromEntries(performanceColumns.filter(c => reportPrefs.visible.includes(c.key)).map(c => [c.label, values[c.key]]));
  });
  return <div className="space-y-4" data-testid="agent-performance-detail" data-agent-id={agentId} data-context={contextKey}>
    <div className="ff-card ff-reports-surface flex flex-wrap items-end gap-2 p-3">
      {/* Reset browser-owned calendar state on external input changes, not on
          each keystroke in that input, which would lose focus during date entry. */}
      <div key={JSON.stringify([user?.id, user?.role, agentId, end, "from"])}><label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label><Input aria-label="From date" data-testid="performance-from-date" type="date" value={start} onChange={e => changeFilters({ start: e.target.value })} className="h-8 w-36 text-xs" /></div>
      <span className="mb-2 text-xs text-slate-400">to</span>
      <div key={JSON.stringify([user?.id, user?.role, agentId, start, "through"])}><label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Through</label><Input aria-label="Through date" data-testid="performance-through-date" type="date" value={end} onChange={e => changeFilters({ end: e.target.value })} className="h-8 w-36 text-xs" /></div>
      <div><label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Employee</label><Select value={agentId} open={agentMenuOpen} onOpenChange={setAgentMenuOpen} onValueChange={onAgentChange}><SelectTrigger data-testid="performance-agent-select" disabled={!optionsReady} className="h-8 w-48 text-xs"><SelectValue key={contextKey}>{optionsReady ? (agentId === "all" ? "All Agents" : (() => { const agent = agentOptions.find(r => String(r.userId ?? r.id) === agentId); return agent ? `${agent.firstName ?? ""} ${agent.lastName ?? ""}`.trim() || agent.email : "Employee unavailable"; })()) : "Refreshing agents…"}</SelectValue></SelectTrigger><SelectContent key={contextKey}><SelectItem value="all">All Agents</SelectItem>{agentOptions.map(r => <SelectItem key={String(r.userId ?? r.id)} value={String(r.userId ?? r.id)}>{`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email}</SelectItem>)}</SelectContent></Select></div>
      <CustomizeColumns columns={performanceColumns} visible={reportPrefs.visible} onChange={reportPrefs.setVisible} templates={reportPrefs.templates} onSave={reportPrefs.saveTemplate} onApply={applyReportTemplate} onDelete={reportPrefs.deleteTemplate} />
      <Button data-testid="performance-csv" disabled={!reportReady || !rows.length} size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => exportCsv("agent_performance.csv", csv)}><Download className="h-3.5 w-3.5" /> Visible CSV</Button>
      {manager && <Button data-testid="performance-issue-warning" disabled={!reportReady || !optionsReady} size="sm" className="h-8 gap-1.5" onClick={() => { setWarningForm(emptyWarningDraft()); createWarning.reset(); activeWarningSession.current += 1; setWarningSession(activeWarningSession.current); setWarningOpen(true); }}><AlertTriangle className="h-3.5 w-3.5" /> Issue warning</Button>}
    </div>
    {(rangeError || query.error || agentOptionsQuery.error || warningQuery.error) && <p role="alert" className="text-sm text-red-700">{rangeError || (query.error || agentOptionsQuery.error || warningQuery.error)?.message}</p>}
    <Card key={contextKey} className="overflow-hidden border border-slate-200 dark:border-slate-700">
      <div className="overflow-x-auto"><table className="ff-data-table w-full min-w-[850px] text-sm">
        <thead><tr className="border-b bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800/60">{performanceColumns.filter(c => reportPrefs.visible.includes(c.key)).map(c => <th key={c.key} className="whitespace-nowrap px-4 py-3">{c.label}</th>)}</tr></thead>
        <tbody className="divide-y">{enabled && query.isFetching ? <SkeletonRows cols={reportPrefs.visible.length} /> : rows.length ? rows.map((r, i) => <tr key={String(r.userId ?? r.id ?? i)} onClick={() => setSelectedAgentId(String(r.userId ?? r.id))} className="cursor-pointer hover:bg-blue-50/60 dark:hover:bg-blue-950/20">
          {reportPrefs.visible.includes("agent") && <td className="px-4 py-3 font-semibold">{`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email || "Unassigned"}</td>}
          {reportPrefs.visible.includes("role") && <td className="px-4 py-3 capitalize text-slate-500">{r.role ?? "agent"}</td>}
          {reportPrefs.visible.includes("invoices") && <td className="px-4 py-3 tabular-nums">{r.invoicesProcessed ?? r.invoiceCount ?? 0}</td>}
          {reportPrefs.visible.includes("volume_funded") && <td className="px-4 py-3 tabular-nums font-semibold">{fmt(Number(r.fundedVolume ?? r.totalVolumeFunded ?? r.totalFunded ?? 0))}</td>}
          {reportPrefs.visible.includes("avg_days_to_fund") && <td className="px-4 py-3 tabular-nums">{r.averageDaysToFund ?? r.avgDaysToFund ?? "—"}{(r.averageDaysToFund ?? r.avgDaysToFund) != null ? "d" : ""}</td>}
          {reportPrefs.visible.includes("reviews") && <td className="px-4 py-3 tabular-nums">{Number(r.carrierReviewsCompleted ?? 0) + Number(r.brokerReviewsCompleted ?? 0)}</td>}
          {reportPrefs.visible.includes("hours") && <td className="px-4 py-3 tabular-nums">{r.hoursWorked ?? r.clockHoursWorked ?? "—"}</td>}
        </tr>) : <tr><td colSpan={reportPrefs.visible.length} className="px-4 py-12 text-center text-slate-500">{rangeError ? "Choose a valid date range to load the report." : query.error ? "Report unavailable." : "No agents found for this period."}</td></tr>}</tbody>
      </table></div>
    </Card>
    <Card key={`warnings:${contextKey}`} data-testid="performance-warnings" className="border border-slate-200 dark:border-slate-700">
      <CardHeader className="flex flex-row items-center justify-between pb-3"><CardTitle className="text-sm">Written warnings · history</CardTitle><span className="text-xs text-slate-500">{enabled && warningQuery.isFetching ? "Refreshing…" : `${warnings.length} recorded`}</span></CardHeader>
      <CardContent className="space-y-2 p-3">{enabled && warningQuery.isFetching ? <div>Loading warnings…</div> : warnings.length ? warnings.map(w => <div key={w.id} className="ff-card ff-reports-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0"><div className="flex items-center gap-2 text-sm font-semibold"><span>{w.agentName ?? w.userId}</span><span className={`ff-badge ${w.severity === "final" ? "ff-badge-rejected" : w.severity === "written" ? "ff-badge-pending" : "ff-badge-draft"} uppercase`}>{w.severity}</span></div><p className="mt-1 text-xs text-slate-500">{w.reason}</p></div>
        <div className="flex items-center gap-3 text-xs text-slate-500"><span>{format(new Date(w.createdAt), "MMM d, yyyy")}</span>{w.acknowledgedAt ? <span className="ff-badge ff-badge-funded gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Acknowledged</span> : String(w.userId) === String(user?.id) ? <Button size="sm" variant="outline" className="h-7" disabled={pendingAcknowledgements.has(w.id)} onClick={() => acknowledge.mutate({ id: w.id, context: contextKey })}>Acknowledge</Button> : <span className="ff-badge ff-badge-pending">Pending</span>}</div>
      </div>) : <div className="px-5 py-10 text-center text-sm text-slate-500">{rangeError ? "Choose a valid date range." : warningQuery.error ? "Warnings unavailable." : "No written warnings in scope."}</div>}
      {acknowledge.error && acknowledge.variables?.context === contextKey && <p role="alert" className="text-sm text-red-700">{acknowledge.error.message}</p>}</CardContent>
    </Card>
    <InvoiceDrilldown key={JSON.stringify([contextKey, selectedAgentId])} open={!!selected} onOpenChange={v => !v && setSelectedAgentId(null)} title={selected ? `${selected.firstName ?? ""} ${selected.lastName ?? ""} · invoice detail` : "Invoice detail"} invoices={selected?.invoices} />
    <Dialog key={JSON.stringify([contextKey, warningSession])} open={warningOpen} onOpenChange={open => { if (!open) { clearWarning(); createWarning.reset(); } }}>
      <DialogContent data-testid="performance-warning-dialog" className="ff-reports-surface">
        <DialogHeader><DialogTitle>Issue written warning</DialogTitle><DialogDescription>Record a performance issue for an agent. The agent will be able to acknowledge it.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div><label className="text-xs font-semibold">Agent</label><Select value={warningForm.userId} onValueChange={v => setWarningForm(f => ({ ...f, userId: v }))}><SelectTrigger data-testid="performance-warning-agent" className="mt-1"><SelectValue placeholder="Select agent" /></SelectTrigger><SelectContent>{agentOptions.map(r => <SelectItem key={String(r.userId ?? r.id)} value={String(r.userId ?? r.id)}>{`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email}</SelectItem>)}</SelectContent></Select></div>
          <div><label className="text-xs font-semibold">Severity</label><Select value={warningForm.severity} onValueChange={v => setWarningForm(f => ({ ...f, severity: v }))}><SelectTrigger data-testid="performance-warning-severity" className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="verbal">Verbal</SelectItem><SelectItem value="written">Written</SelectItem><SelectItem value="final">Final</SelectItem></SelectContent></Select></div>
          <div><label className="text-xs font-semibold">Reason</label><Textarea data-testid="performance-warning-reason" value={warningForm.reason} onChange={e => setWarningForm(f => ({ ...f, reason: e.target.value }))} className="mt-1 min-h-24 w-full p-2 text-sm" placeholder="Describe the issue and expected correction." /></div>
          {createWarning.error && createWarning.variables?.context === contextKey && createWarning.variables.session === warningSession && <p role="alert" className="text-sm text-red-700">{createWarning.error.message}</p>}
        </div>
        <DialogFooter><Button data-testid="performance-warning-cancel" variant="outline" onClick={() => { clearWarning(); createWarning.reset(); }}>Cancel</Button><Button data-testid="performance-warning-save" disabled={!warningForm.userId || !warningForm.reason.trim() || createWarning.isPending} onClick={() => createWarning.mutate({ draft: { ...warningForm }, context: contextKey, session: warningSession })}>Save warning</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

type CarrierBrokerReportRow = {
  id: number; invoiceNumber: string; loadNumber?: string | null; amount: number;
  fundedDate?: string | null; ageDays: number; status: string; chargebackStatus: string;
  appliedAmount?: number; collected?: number; outstanding: number; shortPayAmount?: number;
  accountStatus?: "pending" | "overdue" | "charged_back" | "payment_plan";
};
type CarrierBrokerReportResponse = {
  rows: CarrierBrokerReportRow[];
  summary: { count: number; totalAmount: number; totalOutstanding: number; totalShortPay?: number };
};
type CarrierBrokerReportDef = {
  id: string; title: string; category: string; endpoint: "aging" | "invoices" | "short-pay";
  minDays?: number; includeChargebacks?: boolean; year?: number; type?: "all" | "otr";
};

const CARRIER_BROKER_REPORTS: CarrierBrokerReportDef[] = [
  ...[1, 45, 60, 90, 100].flatMap(minDays => [
    { id: `aging-${minDays}-without`, title: `${minDays}+ Days — Without Chargebacks`, category: "Aging Report · Invoice Summary", endpoint: "aging" as const, minDays, includeChargebacks: false },
    { id: `aging-${minDays}-with`, title: `${minDays}+ Days — With Chargebacks`, category: "Aging Report · Invoice Summary", endpoint: "aging" as const, minDays, includeChargebacks: true },
  ]),
  { id: "aging-status-1", title: "1+ Day — Pending, Overdue, Charged-Back & Payment Plan", category: "Aging Report · Account Status", endpoint: "aging", minDays: 1, includeChargebacks: true },
  { id: "all-invoices", title: "All Invoices", category: "Invoice Reports", endpoint: "invoices", type: "all" },
  { id: "invoices-2025", title: "2025 Invoices", category: "Invoice Reports", endpoint: "invoices", type: "all", year: 2025 },
  { id: "invoices-2026", title: "2026 Invoices", category: "Invoice Reports", endpoint: "invoices", type: "all", year: 2026 },
  { id: "otr-all", title: "All OTR Invoices", category: "Invoice Reports", endpoint: "invoices", type: "otr" },
  { id: "otr-2025", title: "2025 OTR Invoices", category: "Invoice Reports", endpoint: "invoices", type: "otr", year: 2025 },
  { id: "otr-2026", title: "2026 OTR Invoices", category: "Invoice Reports", endpoint: "invoices", type: "otr", year: 2026 },
  { id: "short-pay", title: "Short Pay Report", category: "Other Reports", endpoint: "short-pay" },
];

function SearchableEntitySelect({ label, items, value, onChange, placeholder }: {
  label: string; items: Array<{ id: number; name: string }>; value: string;
  onChange: (value: string) => void; placeholder: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const selected = items.find(item => String(item.id) === value);
  const filtered = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).slice(0, 10);
  return <div className="relative">
    <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300">{label}</label>
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input value={open ? search : selected?.name ?? ""} onFocus={() => { setSearch(""); setOpen(true); }}
        onChange={e => { setSearch(e.target.value); setOpen(true); }} placeholder={placeholder} className="h-10 pl-9 pr-9" />
      {selected && <button type="button" onClick={() => { onChange(""); setSearch(""); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>}
    </div>
    {open && <div className="ff-reports-surface absolute z-30 mt-1 max-h-60 w-full overflow-auto border bg-white p-1 shadow-xl dark:bg-slate-900">
      {filtered.length ? filtered.map(item => <button key={item.id} type="button" onClick={() => { onChange(String(item.id)); setOpen(false); setSearch(""); }}
        className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800">{item.name}</button>)
        : <p className="px-3 py-5 text-center text-xs text-slate-500">No matches found</p>}
    </div>}
  </div>;
}

function CarrierArTab() {
  const [carrierId, setCarrierId] = useState("");
  const [brokerId, setBrokerId] = useState("");
  const [selection, setSelection] = useState<{ carrierId: string; brokerId: string } | null>(null);
  const [report, setReport] = useState<CarrierBrokerReportDef | null>(null);
  const [agingPdfDays, setAgingPdfDays] = useState("1");
  const { user } = useAuth();
  const arColumns: ReportColumn[] = [
    { key: "invoiceNumber", label: "Invoice #" }, { key: "loadNumber", label: "Load #" }, { key: "amount", label: "Amount" },
    { key: "fundedDate", label: "Funded date" }, { key: "ageDays", label: "Age" }, { key: "status", label: "Status" },
    { key: "chargebackStatus", label: "Chargeback" }, { key: "shortPayAmount", label: "Short pay amount" }, { key: "outstanding", label: "Outstanding" },
    { key: "collected", label: "Collected" },
  ];
  const arPrefs = useReportColumns("carrier-ar", user?.id, arColumns, { carrierId, brokerId, reportId: report?.id ?? "" });
  const applyArTemplate = (template: SavedTemplate) => {
    const saved = arPrefs.applyTemplate(template);
    const nextCarrier = saved.carrierId ?? carrierId, nextBroker = saved.brokerId ?? brokerId;
    setCarrierId(nextCarrier); setBrokerId(nextBroker);
    if (nextCarrier && nextBroker) {
      setSelection({ carrierId: nextCarrier, brokerId: nextBroker });
      setReport(CARRIER_BROKER_REPORTS.find(item => item.id === saved.reportId) ?? report);
    }
  };
  const { data: carriersData = [] } = useQuery<Array<{ id: number; name: string }>>({ queryKey: ["/api/clients", { all: true }] });
  const { data: brokersData = [] } = useQuery<Array<{ id: number; name: string }>>({ queryKey: ["/api/brokers", { all: true }] });
  const carriers = Array.isArray(carriersData) ? carriersData : [];
  const brokers = Array.isArray(brokersData) ? brokersData : [];

  const params = useMemo(() => {
    if (!selection || !report) return "";
    const p = new URLSearchParams({ carrierId: selection.carrierId, brokerId: selection.brokerId });
    if (report.minDays != null) p.set("minDays", String(report.minDays));
    if (report.includeChargebacks != null) p.set("includeChargebacks", String(report.includeChargebacks));
    if (report.year) p.set("year", String(report.year));
    if (report.type) p.set("type", report.type);
    if (report.id === "aging-status-1") p.set("statusView", "true");
    return p.toString();
  }, [selection, report]);
  const endpoint = report?.endpoint === "aging" ? "carrier-broker-aging"
    : report?.endpoint === "invoices" ? "carrier-broker-invoices" : "short-pay";
  const reportQuery = useQuery<CarrierBrokerReportResponse>({
    queryKey: ["/api/reports/carrier-broker", report?.id, params],
    queryFn: async () => {
      const response = await fetch(`/api/reports/${endpoint}?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to generate report");
      return response.json();
    },
    enabled: !!selection && !!report,
  });
  const rows = Array.isArray(reportQuery.data?.rows) ? reportQuery.data!.rows : [];
  const selectedCarrier = carriers.find(item => String(item.id) === selection?.carrierId);
  const selectedBroker = brokers.find(item => String(item.id) === selection?.brokerId);
  const reset = () => { setCarrierId(""); setBrokerId(""); setSelection(null); setReport(null); };
  const csvRows = rows.map(row => {
    const values: Record<string, unknown> = {
      invoiceNumber: row.invoiceNumber, loadNumber: row.loadNumber ?? "", amount: row.amount,
      fundedDate: row.fundedDate ?? "", ageDays: row.ageDays,
      status: report?.id === "aging-status-1" && row.accountStatus ? row.accountStatus : row.status,
      chargebackStatus: row.chargebackStatus, collected: row.collected ?? row.appliedAmount ?? 0,
      outstanding: row.outstanding, shortPayAmount: row.shortPayAmount ?? 0,
    };
    return Object.fromEntries(arColumns.filter(column => arPrefs.visible.includes(column.key)).map(column => [column.label, values[column.key]]));
  });
  const pdfParams = report ? new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(params)), reportType: report.endpoint, title: report.title }).toString() : "";

  return <div className="space-y-5">
    <Card>
      <CardHeader className="border-b pb-4"><CardTitle className="text-base">Carrier / Broker AR Report</CardTitle></CardHeader>
      <CardContent className="p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div><p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-blue-600">Step 1</p><SearchableEntitySelect label="Select Carrier" items={carriers} value={carrierId} onChange={setCarrierId} placeholder="Search carriers..." /></div>
          <div><p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-blue-600">Step 2</p><SearchableEntitySelect label="Select Broker" items={brokers} value={brokerId} onChange={setBrokerId} placeholder="Search brokers..." /></div>
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t pt-4">
          <AgingPdfDownload carrierId={carrierId} minDays={agingPdfDays} onMinDaysChange={setAgingPdfDays} compact />
          <Button variant="outline" onClick={() => { setSelection(null); setReport(null); }}>Cancel</Button>
          <Button variant="outline" onClick={reset}>Reset</Button>
          <Button disabled={!carrierId || !brokerId} onClick={() => { setSelection({ carrierId, brokerId }); setReport(null); }}>Submit</Button>
        </div>
      </CardContent>
    </Card>

    {selection && <Card className="border-slate-200 dark:border-slate-700">
      <CardHeader className="border-b pb-4"><CardTitle className="text-base">Available Reports</CardTitle><p className="text-xs text-slate-500">{selectedCarrier?.name} · {selectedBroker?.name}</p></CardHeader>
      <CardContent className="grid gap-5 p-5 lg:grid-cols-2">
        {Array.from(new Set(CARRIER_BROKER_REPORTS.map(item => item.category))).map(category => <section key={category}>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{category}</h3>
          <div className="ff-reports-surface divide-y overflow-hidden border">{CARRIER_BROKER_REPORTS.filter(item => item.category === category).map(item => <button key={item.id} type="button" onClick={() => setReport(item)}
            className={cn("ff-reports-link flex w-full items-center justify-between px-3 py-2.5 text-left text-sm", report?.id === item.id && "font-semibold text-[#087d8d]")}>
            <span>{item.title}</span><ChevronRight className="h-4 w-4" />
          </button>)}</div>
        </section>)}
      </CardContent>
    </Card>}

    {selection && report && <Card className="overflow-hidden border-slate-200 dark:border-slate-700">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b">
        <div><CardTitle className="text-base">{report.title}</CardTitle><p className="mt-1 text-xs text-slate-500">{selectedCarrier?.name} · {selectedBroker?.name}</p></div>
        <div className="flex gap-2">
          <CustomizeColumns columns={arColumns} visible={arPrefs.visible} onChange={arPrefs.setVisible} templates={arPrefs.templates} onSave={arPrefs.saveTemplate} onApply={applyArTemplate} onDelete={arPrefs.deleteTemplate} />
          <Button size="sm" variant="outline" disabled={!rows.length} onClick={() => exportCsv(`${report.id}.csv`, csvRows)}><Download className="mr-1 h-3.5 w-3.5" />Visible CSV</Button>
          <Button size="sm" variant="outline" disabled={!rows.length} asChild><a href={`/api/reports/carrier-broker-pdf?${pdfParams}`} target="_blank" rel="noreferrer"><FileText className="mr-1 h-3.5 w-3.5" />PDF</a></Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {reportQuery.isLoading ? <div className="h-48 animate-pulse bg-slate-100 dark:bg-slate-800" /> : reportQuery.isError ? <div className="p-10 text-center text-sm text-red-600">Unable to generate this report.</div> :
          <div className="overflow-x-auto"><table className="ff-data-table w-full min-w-[900px] text-sm">
            <thead><tr className="border-b bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800/60">{arColumns.filter(column => arPrefs.visible.includes(column.key) && (column.key !== "shortPayAmount" || report.endpoint === "short-pay") && (column.key !== "outstanding" || report.endpoint !== "short-pay")).map(column => <th key={column.key} className="px-4 py-3">{column.key === "outstanding" && report.endpoint === "short-pay" ? "Short Pay Amount" : column.label}</th>)}</tr></thead>
            <tbody className="divide-y">{rows.length ? rows.map(row => <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
              {arColumns.filter(column => arPrefs.visible.includes(column.key) && (column.key !== "shortPayAmount" || report.endpoint === "short-pay") && (column.key !== "outstanding" || report.endpoint !== "short-pay")).map(column => {
                const value = column.key === "status" && report.id === "aging-status-1" && row.accountStatus ? row.accountStatus : (row as unknown as Record<string, unknown>)[column.key];
                const actual = report.endpoint === "short-pay" && column.key === "outstanding" ? row.shortPayAmount ?? row.outstanding : value;
                return <td key={column.key} className="px-4 py-3 tabular-nums">{["amount", "outstanding", "shortPayAmount", "collected"].includes(column.key) ? fmt(Number(actual ?? 0)) : column.key === "fundedDate" && actual ? format(new Date(String(actual)), "MMM d, yyyy") : column.key === "ageDays" ? `${actual ?? "—"}d` : String(actual ?? "—").replace(/_/g, " ")}</td>;
              })}
            </tr>) : <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">No invoices match this report.</td></tr>}</tbody>
            {reportQuery.data?.summary && <tfoot><tr className="border-t-2 bg-slate-50 font-semibold dark:bg-slate-800/60">{arColumns.filter(column => arPrefs.visible.includes(column.key)).map((column, index) => <td key={column.key} className="px-4 py-3 tabular-nums">{index === 0 ? `Totals · ${reportQuery.data!.summary.count} invoices` : column.key === "amount" ? fmt(reportQuery.data!.summary.totalAmount) : column.key === "outstanding" || column.key === "shortPayAmount" ? fmt(report.endpoint === "short-pay" ? reportQuery.data!.summary.totalShortPay ?? reportQuery.data!.summary.totalOutstanding : reportQuery.data!.summary.totalOutstanding) : ""}</td>)}</tr></tfoot>}
          </table></div>}
      </CardContent>
    </Card>}
  </div>;
}

// ─── Global Reports ───────────────────────────────────────────────────────────

type GlobalReportColumn = { key: string; label: string; type?: "money" | "date" | "number" | "text" };
type GlobalReportResponse = {
  title: string;
  columns: GlobalReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  summary: { count: number; totalAmount: number };
};
type GlobalReportLink = { id: string; label: string };

const GLOBAL_REPORT_GROUPS: Array<{ title: string; accent: string; reports: GlobalReportLink[] }> = [
  {
    title: "Aging Report", accent: "border-t-red-500", reports: [
      { id: "aging-1", label: "1+ Day" },
      { id: "aging-45", label: "45+ Days" },
      { id: "aging-60", label: "60+ Days" },
      { id: "aging-90", label: "90+ Days" },
      { id: "aging-100", label: "100+ Days" },
    ],
  },
  {
    title: "Other", accent: "border-t-amber-500", reports: [
      { id: "todays-deposits", label: "Today's Deposits" },
      { id: "all-short-pay", label: "All Short Pay Report" },
      { id: "uncollected-2025", label: "2025 Uncollected AR" },
      { id: "dso", label: "DSO (Days Sales Outstanding)" },
      { id: "monthly-sales-journal", label: "Monthly Sales Journal Reports" },
      { id: "aging-90-chargebacks", label: "90 Plus Days Reports" },
    ],
  },
  {
    title: "Brokers", accent: "border-t-blue-500", reports: [
      { id: "brokers-all", label: "All Broker List" },
      { id: "brokers-active", label: "All Active Broker List" },
      { id: "brokers-inactive", label: "All Inactive Broker List" },
      { id: "brokers-active-dump", label: "Active Broker (Dump)" },
      { id: "brokers-active-otr", label: "Active Broker (OTR)" },
    ],
  },
  {
    title: "Carriers", accent: "border-t-emerald-500", reports: [
      { id: "carriers-all", label: "All Carrier List" },
      { id: "carriers-active-all", label: "Active Carrier all info (All)" },
      { id: "carriers-active-basic", label: "Active Carrier less info (All)" },
      { id: "carriers-active-dump-all", label: "Active Carrier all info (Dump)" },
      { id: "carriers-active-dump-basic", label: "Active Carrier less info (Dump)" },
      { id: "carriers-active-otr-all", label: "Active Carrier all info (OTR)" },
      { id: "carriers-active-otr-basic", label: "Active Carrier less info (OTR)" },
      { id: "carriers-top-20", label: "Active Carrier Top 20" },
      { id: "carriers-noa", label: "Carrier's NOA" },
    ],
  },
];

function GlobalReportsTab() {
  const [reportId, setReportId] = useState<string | null>(null);
  const { user } = useAuth();
  const reportQuery = useQuery<GlobalReportResponse>({
    queryKey: ["/api/reports/global", reportId],
    queryFn: async () => {
      const response = await fetch(`/api/reports/global/${reportId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to generate report");
      return response.json();
    },
    enabled: !!reportId,
  });
  const report = reportQuery.data;
  const globalColumns: ReportColumn[] = (report?.columns ?? []).map(column => ({ key: column.key, label: column.label }));
  const globalPrefs = useReportColumns(`global-${reportId ?? "none"}`, user?.id, globalColumns, { reportId: reportId ?? "" });
  const applyGlobalTemplate = (template: SavedTemplate) => {
    const saved = globalPrefs.applyTemplate(template);
    if (saved.reportId) setReportId(saved.reportId);
  };
  const formatCell = (value: string | number | null, column: GlobalReportColumn) => {
    if (value == null || value === "") return "—";
    if (column.type === "money") return fmt(Number(value));
    if (column.type === "date") {
      const dateValue = String(value);
      const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? `${dateValue}T00:00:00` : dateValue);
      return Number.isNaN(parsed.getTime()) ? String(value) : format(parsed, "MMM d, yyyy");
    }
    if (column.type === "number") return Number(value).toLocaleString();
    return String(value).replace(/_/g, " ");
  };
  const csvRows = report?.rows.map(row => Object.fromEntries(
    report.columns.filter(column => globalPrefs.visible.includes(column.key)).map(column => [column.label, row[column.key] ?? ""]),
  )) ?? [];

  return <div className="space-y-5">
    <div>
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">Global Reports</h2>
      <p className="mt-0.5 text-sm text-slate-500">Select any report to view current results and export them.</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {GLOBAL_REPORT_GROUPS.map(group => <Card key={group.title} className={cn("ff-reports-surface overflow-hidden border-t-4", group.accent)}>
        <CardHeader className="ff-reports-section-header border-b px-4 py-3">
          <CardTitle className="text-sm uppercase tracking-wider">{group.title}</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          <div className="divide-y dark:divide-slate-800">
            {group.reports.map(item => <button key={item.id} type="button" onClick={() => setReportId(item.id)}
              className={cn("ff-reports-link flex w-full items-center justify-between gap-2 px-2.5 py-2.5 text-left text-sm", reportId === item.id && "font-semibold text-[#087d8d]")}>
              <span>{item.label}</span><ChevronRight className="h-4 w-4 shrink-0 opacity-60" />
            </button>)}
          </div>
        </CardContent>
      </Card>)}
    </div>

    {reportId && <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b">
        <div>
          <CardTitle className="text-base">{report?.title ?? "Generating report…"}</CardTitle>
          {report && <p className="mt-1 text-xs text-slate-500">{report.summary.count.toLocaleString()} records · {fmt(report.summary.totalAmount)}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <CustomizeColumns columns={globalColumns} visible={globalPrefs.visible} onChange={globalPrefs.setVisible} templates={globalPrefs.templates} onSave={globalPrefs.saveTemplate} onApply={applyGlobalTemplate} onDelete={globalPrefs.deleteTemplate} />
          <Button size="sm" variant="outline" disabled={!report?.rows.length} onClick={() => exportCsv(`${reportId}.csv`, csvRows)}><Download className="mr-1 h-3.5 w-3.5" />Visible CSV</Button>
          <Button size="sm" variant="outline" disabled={!report?.rows.length} asChild>
            <a href={`/api/reports/global/${reportId}/pdf`} target="_blank" rel="noreferrer"><FileText className="mr-1 h-3.5 w-3.5" />PDF</a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {reportQuery.isLoading ? <div className="h-56 animate-pulse bg-slate-100 dark:bg-slate-800" />
          : reportQuery.isError ? <div className="p-12 text-center text-sm text-red-600">Unable to generate this report.</div>
          : report ? <div className="overflow-x-auto"><table className="ff-data-table w-full min-w-max text-sm">
            <thead><tr className="border-b bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800/60">
              {report.columns.filter(column => globalPrefs.visible.includes(column.key)).map(column => <th key={column.key} className="whitespace-nowrap px-4 py-3">{column.label}</th>)}
            </tr></thead>
            <tbody className="divide-y dark:divide-slate-800">{report.rows.length ? report.rows.map((row, index) => <tr key={String(row.id ?? row.invoiceNumber ?? index)} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
              {report.columns.filter(column => globalPrefs.visible.includes(column.key)).map(column => <td key={column.key} className={cn("max-w-xs whitespace-nowrap px-4 py-3 capitalize", ["money", "number"].includes(column.type ?? "") && "text-right tabular-nums", column.key === "invoiceNumber" && "font-semibold")}>{formatCell(row[column.key], column)}</td>)}
            </tr>) : <tr><td colSpan={globalPrefs.visible.length} className="px-4 py-14 text-center text-slate-500">No records match this report.</td></tr>}</tbody>
          </table></div> : null}
      </CardContent>
    </Card>}
  </div>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Reports() {
  const routeSearch = useSearch();
  const requestedTab = new URLSearchParams(routeSearch).get("tab");
  const validTab = TABS.find(tab => tab.id === requestedTab)?.id;
  const [activeTab, setActiveTab] = useState<TabId>(validTab ?? "global");
  useEffect(() => { setActiveTab(validTab ?? "global"); }, [validTab]);

  return (
    <div className="ff-reports-page flex h-screen bg-[#d4d0c8]">
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

            <Win95Tabs value={activeTab} onValueChange={value => setActiveTab(value as TabId)}>
              <Win95TabsList>
                {TABS.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <Win95TabsTrigger key={tab.id} value={tab.id}>
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </Win95TabsTrigger>
                  );
                })}
              </Win95TabsList>
            </Win95Tabs>

            <div>
              {activeTab === "global"   && <GlobalReportsTab />}
              {activeTab === "aging"    && <AgingReport />}
              {activeTab === "agent"    && <AgentTab />}
              {activeTab === "agent-performance" && <AgentPerformanceTab />}
              {activeTab === "broker"   && <BrokerTab />}
              {activeTab === "carrier"  && <CarrierTab />}
              {activeTab === "carrier-ar" && <CarrierArTab />}
              {activeTab === "chargeback" && <ChargebackReport />}
              {activeTab === "daily-ar" && <DailyARTab />}
              {activeTab === "monthly"  && <MonthlyTab />}
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}
