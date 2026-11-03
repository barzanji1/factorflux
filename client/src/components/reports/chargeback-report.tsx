import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { Download, FileWarning, RefreshCw, Search, ChevronDown, ChevronRight, CircleDollarSign } from "lucide-react";
import { Link } from "wouter";
import type { ChargebackReport, ChargebackReportRow } from "@shared/chargeback-report";
import { useAuth } from "@/hooks/useAuth";
import { NeuBadge, NeuButton, NeuInput, NeuSelect } from "@/styles/neu/components";
import { RecoveryTable, RecoveryCard, RecoveryStatCard } from "@/components/recovery/recovery-controls";
import { CustomizeColumns, useReportColumns, type ReportColumn, type SavedTemplate } from "./report-customization";

type DirectoryEntity = { id: number; name: string };
type DirectoryResponse = DirectoryEntity[] | { data?: DirectoryEntity[] };
type Filters = { startDate: string; endDate: string; carrierId: string; brokerId: string; status: string; deductionType: string; minAmount: string; maxAmount: string };
type ExtendedRow = ChargebackReportRow & {
  refundDate: string | null; refundedAmount: number; netChargeback: number | null; paymentReference: string | null;
  recoveredAmount: number; originalShortPay: number; collectedAmount: number; writtenOffAmount: number;
};
type ExtendedTotals = { count: number; originalAmount: number; amount: number; outstanding: number; refunded: number; collected: number; writtenOff: number; recovered: number; netOutstanding: number; byType?: Record<string, number>; unknownAmounts: number };
const today = format(new Date(), "yyyy-MM-dd");
const initialFilters: Filters = { startDate: format(startOfMonth(new Date()), "yyyy-MM-dd"), endDate: today, carrierId: "", brokerId: "", status: "all", deductionType: "all", minAmount: "", maxAmount: "" };
const money = (value: number | null | undefined) => value == null ? "—" : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const reportDate = (value: string | null | undefined) => {
  if (!value) return "—"; const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", dateStyle: "medium" }).format(date) : value;
};
const validDay = (value: string) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const columnSets: Record<Section, ReportColumn[]> = {
  chargebacks: [
    { key: "date", label: "Date" }, { key: "invoiceNumber", label: "Invoice" }, { key: "carrierName", label: "Carrier" }, { key: "brokerName", label: "Broker" },
    { key: "originalAmount", label: "Original amount" }, { key: "amount", label: "Chargeback amount" }, { key: "refundDate", label: "Refund date" },
    { key: "refundedAmount", label: "Refunded amount" }, { key: "netChargeback", label: "Net chargeback" }, { key: "paymentReference", label: "Payment reference" },
    { key: "reason", label: "Reason" }, { key: "status", label: "Status" },
  ],
  shortPays: [
    { key: "date", label: "Date" }, { key: "invoiceNumber", label: "Invoice" }, { key: "carrierName", label: "Carrier" }, { key: "brokerName", label: "Broker" },
    { key: "originalShortPay", label: "Short paid" }, { key: "recoveredAmount", label: "Recovered" }, { key: "collectedAmount", label: "Collected" },
    { key: "writtenOffAmount", label: "Written off" }, { key: "amount", label: "Difference" }, { key: "outstanding", label: "Net outstanding" },
    { key: "paymentReference", label: "Reference" }, { key: "status", label: "Status" },
  ],
  deductions: [
    { key: "date", label: "Date" }, { key: "invoiceNumber", label: "Invoice" }, { key: "carrierName", label: "Carrier" }, { key: "brokerName", label: "Broker" },
    { key: "kind", label: "Deduction type" }, { key: "reason", label: "Reason" }, { key: "amount", label: "Signed amount" }, { key: "status", label: "Status" },
  ],
};
type Section = "chargebacks" | "shortPays" | "deductions";
const sectionLabels: Record<Section, string> = { chargebacks: "Chargebacks", shortPays: "Short pays", deductions: "Deductions" };

function SearchDirectory({ kind, label, value, onChange }: { kind: "carrier" | "broker"; label: string; value: string; onChange: (value: DirectoryEntity | null) => void }) {
  const [open, setOpen] = useState(false); const [search, setSearch] = useState(""); const [debounced, setDebounced] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);
  const query = useQuery<DirectoryResponse>({
    queryKey: ["/api/reports/chargeback/options", kind, debounced],
    queryFn: async ({ signal }) => { const params = new URLSearchParams({ kind, q: debounced, limit: "8" }); const r = await fetch(`/api/reports/chargeback/options?${params}`, { credentials: "include", signal }); if (!r.ok) throw new Error(`Unable to search ${kind}s`); return r.json(); },
    enabled: open,
  });
  const options = Array.isArray(query.data) ? query.data : query.data?.data ?? [];
  const selected = options.find(item => String(item.id) === value);
  return <div className="relative min-w-[170px]"><label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#666]">{label}</label>
    <div className="relative"><Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#777]" /><NeuInput value={open ? search : selected?.name ?? (value ? `Selected #${value}` : "")} placeholder={`Search ${kind}s`} className="min-h-9 rounded-lg pl-7 text-xs" onFocus={() => { setSearch(""); setOpen(true); }} onChange={e => { setSearch(e.target.value); setOpen(true); }} onKeyDown={e => e.key === "Escape" && setOpen(false)} />
      {value && <button type="button" aria-label={`Clear ${label}`} onClick={() => { onChange(null); setSearch(""); }} className="absolute right-2 top-1/2 text-xs">×</button>}</div>
    {open && <div className="recovery-neu-menu absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-lg bg-[#e0e0e0] p-1 shadow-[4px_4px_9px_#aaa,-4px_-4px_9px_#fff]">
      {query.isLoading ? <p className="p-2 text-xs">Searching…</p> : query.isError ? <button className="p-2 text-xs text-red-700" onClick={() => void query.refetch()}>Search failed — retry</button> : options.length ? options.map(item => <button key={item.id} onClick={() => { onChange(item); setOpen(false); }} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[#cce5e5]">{item.name}</button>) : <p className="p-2 text-xs text-[#666]">No matching records</p>}
      <button className="w-full border-t border-[#c0c0c0] px-2 py-1.5 text-left text-[10px]" onClick={() => { onChange(null); setOpen(false); }}>All {kind}s</button>
    </div>}
  </div>;
}

function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }

function ResolutionModal({ row, onClose }: { row: ExtendedRow; onClose: () => void }) {
  const { user } = useAuth();
  const canWriteOff = user?.role === "admin" || user?.role === "manager";
  const client = useQueryClient(); const [amount, setAmount] = useState(row.outstanding > 0 ? String(row.outstanding) : ""); const [date, setDate] = useState(today);
  const [reference, setReference] = useState(""); const [status, setStatus] = useState<"resolved" | "written_off">("resolved"); const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/invoices/${row.invoiceId}/short-pay/resolutions`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: Number(amount), date, reference, status, idempotencyKey: key }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || "Resolution could not be recorded."); return body;
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["/api/reports/chargeback"] }); onClose(); },
    onError: e => setError(e instanceof Error ? e.message : "Resolution could not be recorded."),
  });
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#263638]/40 p-4"><section role="dialog" aria-modal="true" aria-labelledby="shortpay-title" className="recovery-neu-dialog w-full max-w-md rounded-2xl bg-[#e0e0e0] p-5 shadow-[8px_8px_24px_#777,-6px_-6px_20px_#fff]">
    <h3 id="shortpay-title" className="text-lg font-bold">Record short-pay resolution</h3><p className="mt-1 text-xs text-[#666]">{row.invoiceNumber} · outstanding {money(row.outstanding)}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Amount<NeuInput className="mt-1 min-h-9" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label><label className="text-xs font-semibold">Date<NeuInput className="mt-1 min-h-9" type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label className="text-xs font-semibold">Reference<NeuInput className="mt-1 min-h-9" value={reference} onChange={e => setReference(e.target.value)} /></label><label className="text-xs font-semibold">Outcome<NeuSelect className="mt-1 min-h-9" value={status} onChange={e => setStatus(e.target.value as "resolved" | "written_off")}><option value="resolved">Cash recovered</option>{canWriteOff && <option value="written_off">Written off</option>}</NeuSelect></label></div>
    {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
    <div className="mt-5 flex justify-end gap-2"><NeuButton className="min-h-9 px-3" onClick={onClose} disabled={mutation.isPending}>Cancel</NeuButton><NeuButton variant="accent" className="min-h-9 px-3" disabled={!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > row.outstanding || !date || !reference.trim() || mutation.isPending} onClick={() => void mutation.mutate()}>{mutation.isPending ? "Saving…" : "Record outcome"}</NeuButton></div>
  </section></div>;
}

function ChargebackReportTable({ section, rows, totals, columns, visible, onResolve }: { section: Section; rows: ExtendedRow[]; totals: ExtendedTotals; columns: ReportColumn[]; visible: string[]; onResolve: (row: ExtendedRow) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const timeline = useQuery({
    queryKey: ["/api/invoices", expanded, "chargeback", "lifecycle"],
    enabled: !!expanded,
    queryFn: async ({ signal }) => { const r = await fetch(`/api/invoices/${expanded}/chargeback/lifecycle`, { credentials: "include", signal }); const body = await r.json(); if (!r.ok) throw new Error(body.message || "Could not load events."); return body as { events: Array<{ id: number; eventType: string; createdAt: string; actorName: string; amount: string | null; reason: string; reference: string }> }; },
  });
  const visibleColumns = columns.filter(c => visible.includes(c.key));
  const getValue = (row: ExtendedRow, key: string): string | number | null => {
    const map: Record<string, string | number | null> = {
      date: reportDate(row.date), invoiceNumber: row.invoiceNumber, carrierName: row.carrierName, brokerName: row.brokerName || "—",
      originalAmount: row.originalAmount, amount: row.amount, refundDate: reportDate(row.refundDate), refundedAmount: row.refundedAmount,
      netChargeback: row.netChargeback, paymentReference: row.paymentReference, reason: row.reason || "—", status: row.status.replace(/_/g, " "),
      originalShortPay: row.originalShortPay, recoveredAmount: row.recoveredAmount, collectedAmount: row.collectedAmount,
      writtenOffAmount: row.writtenOffAmount, outstanding: row.outstanding, kind: row.kind?.replace(/_/g, " ") || "—",
    };
    return map[key] ?? "—";
  };
  return <RecoveryCard className="overflow-hidden rounded-xl">
    <header className="flex items-center justify-between px-4 py-3"><h3 className="text-xs font-bold uppercase tracking-wide">{sectionLabels[section]}</h3><NeuBadge>{totals.count} rows</NeuBadge></header>
    <div className="overflow-x-auto"><RecoveryTable className="w-full min-w-[1000px] border-collapse text-xs">
      <thead><tr className="bg-[#404040] text-left text-[10px] uppercase tracking-wide text-white"><th className="w-8 px-2 py-2" aria-label="Expand row" />{visibleColumns.map(c => <th key={c.key} className={`whitespace-nowrap px-2.5 py-2 ${["amount", "originalAmount", "refundedAmount", "netChargeback", "recoveredAmount", "collectedAmount", "writtenOffAmount", "originalShortPay", "outstanding"].includes(c.key) ? "text-right" : ""}`}>{c.label}</th>)}{section === "shortPays" && <th className="px-2 py-2 text-right">Action</th>}</tr></thead>
      <tbody className="divide-y divide-[#c7c7c7]">{rows.map(row => <Fragment key={`group-${row.id}`}>
        <tr className="transition-colors hover:bg-[#d8eeee]">
          <td className="px-2 py-2"><button type="button" aria-label={`${expanded === String(row.invoiceId) ? "Hide" : "Show"} timeline for ${row.invoiceNumber}`} onClick={() => setExpanded(expanded === String(row.invoiceId) ? null : String(row.invoiceId))} className="rounded p-1 hover:bg-[#c1dfdf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#168f9b]">{expanded === String(row.invoiceId) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button></td>
          {visibleColumns.map(c => <td key={c.key} className={`max-w-[220px] px-2.5 py-2 ${["amount", "originalAmount", "refundedAmount", "netChargeback", "recoveredAmount", "collectedAmount", "writtenOffAmount", "originalShortPay", "outstanding"].includes(c.key) ? "whitespace-nowrap text-right font-mono tabular-nums" : "truncate"}`} title={String(getValue(row, c.key) ?? "")}>
            {c.key === "invoiceNumber" ? <Link className="font-semibold text-[#126277] underline decoration-dotted hover:decoration-solid" href={`/invoices/${row.invoiceId}`}>{row.invoiceNumber}</Link>
              : ["amount", "originalAmount", "refundedAmount", "netChargeback", "recoveredAmount", "collectedAmount", "writtenOffAmount", "originalShortPay", "outstanding"].includes(c.key) ? money(getValue(row, c.key) as number | null)
              : c.key === "status" ? <NeuBadge tone={["refunded", "resolved", "collected"].includes(row.status) ? "success" : row.status === "written_off" ? "warning" : "neutral"}>{String(getValue(row, c.key))}</NeuBadge>
              : String(getValue(row, c.key) ?? "—")}
          </td>)}
          {section === "shortPays" && <td className="px-2 py-2 text-right">{row.status === "open"
            ? <NeuButton className="min-h-8 rounded-md px-2 text-[10px]" onClick={() => onResolve(row)}><CircleDollarSign className="h-3.5 w-3.5" />Resolve</NeuButton>
            : <NeuBadge tone={["resolved", "collected"].includes(row.status) ? "success" : "neutral"}>{row.status.replace(/_/g, " ")}</NeuBadge>}</td>}
        </tr>
        {expanded === String(row.invoiceId) && <tr><td colSpan={visibleColumns.length + 1 + (section === "shortPays" ? 1 : 0)} className="bg-[#d9e7e7] p-3">
          {timeline.isLoading ? <div className="h-12 animate-pulse rounded bg-[#c8d5d5]" /> : timeline.isError ? <div role="alert" className="text-xs text-red-700">Timeline unavailable. <button className="underline" onClick={() => void timeline.refetch()}>Retry</button></div> : <ol className="grid gap-2 sm:grid-cols-2">{(timeline.data?.events ?? []).map(event => <li key={event.id} className="rounded-lg bg-[#e0e0e0] p-2 shadow-[1px_1px_4px_#bbb,-1px_-1px_4px_#fff]"><div className="flex justify-between gap-2"><strong className="capitalize">{event.eventType.replace(/_/g, " ")}</strong><span className="text-[#666]">{reportDate(event.createdAt)}</span></div><p className="mt-1 text-[#666]">{event.actorName || "System"}{event.amount != null ? ` · ${money(Number(event.amount))}` : ""}{event.reference ? ` · ${event.reference}` : ""}</p>{event.reason && <p className="mt-1">{event.reason}</p>}</li>)}</ol>}
        </td></tr>}
      </Fragment>)}
      {!rows.length && <tr><td colSpan={visibleColumns.length + 2} className="px-4 py-10 text-center text-[#777]">No {sectionLabels[section].toLowerCase()} match these filters.</td></tr>}</tbody>
    </RecoveryTable></div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-[#aaa] bg-[#d5d5d5] px-3 py-2 text-[10px]">
      <strong>{totals.count} rows · {totals.unknownAmounts ? `${totals.unknownAmounts} unknown amount(s) excluded` : "Known amounts"}</strong>
      {section === "chargebacks" ? <span className="font-mono">Chargebacks {money(totals.amount)} · Refunded {money(totals.refunded)} · Collected {money(totals.collected)} · Written off {money(totals.writtenOff)} · Net {money(totals.netOutstanding)}</span>
        : section === "shortPays" ? <span className="font-mono">Short paid {money(totals.amount)} · Recovered {money(totals.recovered)} · Written off {money(totals.writtenOff)} · Outstanding {money(totals.netOutstanding ?? totals.outstanding)}</span>
        : <span className="font-mono">Net signed {money(totals.amount)} · By type {Object.entries(totals.byType ?? {}).map(([type, value]) => `${type.replace(/_/g, " ")} ${money(value)}`).join(" · ") || "—"}</span>}
    </footer>
  </RecoveryCard>;
}

export default function ChargebackReport() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [activeSection, updateActiveSection] = useState<Section>("chargebacks");
  const setActiveSection = (section: Section) => {
    updateActiveSection(section);
    setFilters(old => ({ ...old, status: "all", deductionType: "all" }));
  };
  const statusOptions = activeSection === "chargebacks" ? ["all", "open", "collected", "refunded", "written_off"]
    : activeSection === "shortPays" ? ["all", "open", "resolved", "written_off"] : ["all", "applied"];
  const [carrier, setCarrier] = useState(""); const [broker, setBroker] = useState("");
  const [exportError, setExportError] = useState(""); const [exporting, setExporting] = useState(false); const [resolveRow, setResolveRow] = useState<ExtendedRow | null>(null);
  const errors = useMemo(() => {
    const e: Partial<Record<keyof Filters, string>> = {};
    if (!validDay(filters.startDate)) e.startDate = "Enter a valid date.";
    if (!validDay(filters.endDate)) e.endDate = "Enter a valid date.";
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) e.endDate = "End date must follow start date.";
    for (const k of ["minAmount", "maxAmount"] as const) if (filters[k] && (!Number.isFinite(Number(filters[k])) || Number(filters[k]) < 0)) e[k] = "Enter a non-negative amount.";
    if (filters.minAmount && filters.maxAmount && Number(filters.minAmount) > Number(filters.maxAmount)) e.maxAmount = "Maximum must be at least minimum.";
    return e;
  }, [filters]);
  const params = useMemo(() => { const p = new URLSearchParams(); Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); }); return p; }, [filters]);
  const reportQuery = useQuery<ChargebackReport>({
    queryKey: ["/api/reports/chargeback", ...Object.values(filters)],
    queryFn: async ({ signal }) => { const r = await fetch(`/api/reports/chargeback?${params}`, { credentials: "include", signal }); const body = await r.json(); if (!r.ok) throw new Error(body.message || "Unable to load chargeback report"); return body; },
    enabled: !Object.keys(errors).length, refetchOnMount: "always",
  });
  const columns = columnSets[activeSection];
  const prefs = useReportColumns(`chargeback-${activeSection}`, user?.id, columns, filters as unknown as Record<string, string>);
  const setFilter = (key: keyof Filters, value: string) => setFilters(old => ({ ...old, [key]: value }));
  const applyTemplate = (template: SavedTemplate) => {
    const saved = prefs.applyTemplate(template) as Partial<Filters>;
    setFilters(old => ({ ...old, ...Object.fromEntries(Object.entries(saved).filter(([k, v]) => k in old && typeof v === "string")) } as Filters));
    if (saved.carrierId !== undefined) setCarrier(saved.carrierId); if (saved.brokerId !== undefined) setBroker(saved.brokerId);
  };
  async function exportCsv() {
    if (!reportQuery.data || reportQuery.isFetching || reportQuery.isError || Object.keys(errors).length) return;
    setExporting(true); setExportError("");
    try {
      const query = new URLSearchParams(params); query.set("section", activeSection); query.set("columns", prefs.visible.join(","));
      const response = await fetch(`/api/reports/chargeback.csv?${query}`, { credentials: "include" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || "CSV export failed."); }
      downloadBlob(await response.blob(), `Trucking_Pros_Financial_${activeSection}_${filters.startDate || "all"}_${filters.endDate || "all"}.csv`);
    } catch (error) { setExportError(error instanceof Error ? error.message : "CSV export failed."); } finally { setExporting(false); }
  }
  const report = reportQuery.data;
  const totalsBySection = report?.totals as unknown as Record<Section, ExtendedTotals> | undefined;
  const rowsBySection = report as unknown as (ChargebackReport & Record<Section, ExtendedRow[]>) | undefined;
  const applyDirectory = (kind: "carrier" | "broker", entity: DirectoryEntity | null) => {
    const value = entity ? String(entity.id) : ""; if (kind === "carrier") setCarrier(value); else setBroker(value);
    setFilter(kind === "carrier" ? "carrierId" : "brokerId", value);
  };
  return <div className="space-y-3 text-[#333]">
    <RecoveryCard className="overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><h2 className="text-sm font-bold">Chargeback &amp; reconciliation</h2><p className="mt-0.5 text-[10px] text-[#666]">Recorded cash movements · refund ledger · short-pay recovery</p></div><div className="flex flex-wrap gap-2">
        <CustomizeColumns columns={columns} visible={prefs.visible} onChange={prefs.setVisible} templates={prefs.templates} onSave={prefs.saveTemplate} onApply={applyTemplate} onDelete={prefs.deleteTemplate} />
        <NeuButton variant="accent" className="min-h-9 rounded-lg px-3 text-xs" disabled={!report || reportQuery.isFetching || !!Object.keys(errors).length || exporting} onClick={() => void exportCsv()}><Download className="h-4 w-4" />{exporting ? "Exporting…" : "Export visible columns"}</NeuButton>
      </div></header>
      <div className="grid min-w-0 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {(["startDate", "endDate"] as const).map((key, i) => <label key={key} className="text-[10px] font-bold uppercase tracking-wide text-[#666]">{i ? "Through" : "From"}<NeuInput type="date" className="mt-1 min-h-9 rounded-lg text-xs" value={filters[key]} onChange={e => setFilter(key, e.target.value)} aria-invalid={!!errors[key]} />{errors[key] && <span className="text-red-700">{errors[key]}</span>}</label>)}
        <SearchDirectory kind="carrier" label="Carrier" value={carrier} onChange={item => applyDirectory("carrier", item)} />
        <SearchDirectory kind="broker" label="Broker" value={broker} onChange={item => applyDirectory("broker", item)} />
        <label className="text-[10px] font-bold uppercase tracking-wide text-[#666]">Status<NeuSelect className="mt-1 min-h-9 rounded-lg text-xs" value={filters.status} onChange={e => setFilter("status", e.target.value)}>{statusOptions.map(status => <option key={status} value={status}>{status === "all" ? "All statuses" : status.replace(/_/g, " ").replace(/^./, c => c.toUpperCase())}</option>)}</NeuSelect></label>
        <label className="text-[10px] font-bold uppercase tracking-wide text-[#666]">Deduction type<NeuSelect className="mt-1 min-h-9 rounded-lg text-xs" value={filters.deductionType} onChange={e => setFilter("deductionType", e.target.value)}><option value="all">All types</option><option value="fee_adjustment">Fee adjustment</option><option value="reserve_movement">Reserve movement</option><option value="offset">Offset</option></NeuSelect></label>
        {(["minAmount", "maxAmount"] as const).map((key, i) => <label key={key} className="text-[10px] font-bold uppercase tracking-wide text-[#666]">{i ? "Maximum $" : "Minimum $"}<NeuInput inputMode="decimal" className="mt-1 min-h-9 rounded-lg text-xs" placeholder={i ? "No maximum" : "No minimum"} value={filters[key]} onChange={e => setFilter(key, e.target.value)} aria-invalid={!!errors[key]} />{errors[key] && <span className="text-red-700">{errors[key]}</span>}</label>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Reconciliation report sections">{(["chargebacks", "shortPays", "deductions"] as Section[]).map(section => <button key={section} type="button" role="tab" aria-selected={activeSection === section} onClick={() => setActiveSection(section)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#168f9b] ${activeSection === section ? "bg-[#e0e0e0] text-[#087d8d] shadow-[inset_2px_2px_4px_#c1c1c1,inset_-2px_-2px_4px_#fff]" : "hover:bg-[#cde5e5]"}`}>{sectionLabels[section]}</button>)}</div>
        <NeuButton className="min-h-8 rounded-lg px-2.5 text-[10px]" onClick={() => { setFilters(initialFilters); setCarrier(""); setBroker(""); }}><RefreshCw className="h-3 w-3" />Reset filters</NeuButton>
      </div>
    </RecoveryCard>
    {!!Object.keys(errors).length && <p role="alert" className="rounded-lg border border-[#c8a85f] bg-[#fff4d3] p-3 text-xs text-[#604b16]">Correct the highlighted filters to load this report.</p>}
    {exportError && <p role="alert" className="rounded-lg border border-red-400 bg-red-50 p-3 text-xs text-red-800">{exportError}</p>}
    {!Object.keys(errors).length && (reportQuery.isLoading || reportQuery.isFetching) ? <div className="space-y-3" aria-label="Loading chargeback report">{[1, 2].map(k => <div key={k} className="h-36 animate-pulse rounded-xl bg-[#d0d0d0] shadow-[inset_2px_2px_6px_#bbb,inset_-2px_-2px_6px_#fff]" />)}</div>
      : reportQuery.isError ? <div role="alert" className="rounded-xl bg-[#e0e0e0] p-7 text-center shadow-[3px_3px_8px_#bdbdbd,-3px_-3px_8px_#fff]"><FileWarning className="mx-auto mb-2 h-5 w-5 text-red-700" /><p className="font-bold">Report could not be loaded</p><p className="mt-1 text-xs text-[#666]">{reportQuery.error instanceof Error ? reportQuery.error.message : "No export is available until this report loads."}</p><NeuButton className="mt-3 min-h-9 px-3" onClick={() => void reportQuery.refetch()}>Retry</NeuButton></div>
      : report && <div className="space-y-3">
        {report.notices?.length > 0 && <aside className="rounded-lg border border-[#c4b878] bg-[#fff8dc] px-3 py-2 text-[11px] text-[#51482c]"><strong>Accounting notes: </strong>{report.notices.join(" ")}</aside>}
        <ChargebackReportTable section={activeSection} rows={rowsBySection?.[activeSection] ?? []} totals={totalsBySection?.[activeSection] ?? { count: 0, originalAmount: 0, amount: 0, outstanding: 0, refunded: 0, collected: 0, writtenOff: 0, recovered: 0, netOutstanding: 0, unknownAmounts: 0 }} columns={columns} visible={prefs.visible} onResolve={setResolveRow} />
        {activeSection === "chargebacks" && <div className="grid gap-2 sm:grid-cols-5">{[
          ["Chargebacks", money(totalsBySection?.chargebacks?.amount)], ["Refunded", money(totalsBySection?.chargebacks?.refunded)], ["Collected", money(totalsBySection?.chargebacks?.collected)], ["Written off", money(totalsBySection?.chargebacks?.writtenOff)], ["Net outstanding", money(totalsBySection?.chargebacks?.netOutstanding)],
         ].map(([label, value]) => <RecoveryStatCard key={String(label)} label={String(label)} value={value} className="min-h-24 p-3" />)}</div>}
      </div>}
    {resolveRow && <ResolutionModal row={resolveRow} onClose={() => setResolveRow(null)} />}
  </div>;
}
