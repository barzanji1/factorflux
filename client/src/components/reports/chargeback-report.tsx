import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { Download, Search, RefreshCw, FileWarning } from "lucide-react";
import { Link } from "wouter";
import type { ChargebackReport, ChargebackReportRow, ChargebackReportTotals } from "@shared/chargeback-report";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type DirectoryEntity = { id: number; name: string };
type DirectoryResponse = DirectoryEntity[] | { data?: DirectoryEntity[] };
type DirectoryKind = "carrier" | "broker";
type Filters = {
  startDate: string;
  endDate: string;
  carrierId: string;
  brokerId: string;
  status: string;
  minAmount: string;
  maxAmount: string;
};

const today = format(new Date(), "yyyy-MM-dd");
const initialFilters: Filters = {
  startDate: format(startOfMonth(new Date()), "yyyy-MM-dd"),
  endDate: today,
  carrierId: "",
  brokerId: "",
  status: "all",
  minAmount: "",
  maxAmount: "",
};

function validDay(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function money(value: number | null | undefined) {
  return value == null ? "—" : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatReportDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function directoryItems(value: DirectoryResponse | undefined): DirectoryEntity[] {
  return Array.isArray(value) ? value : value?.data ?? [];
}

function SearchDirectory({
  kind, label, selected, onSelect,
}: {
  kind: DirectoryKind;
  label: string;
  selected: DirectoryEntity | null;
  onSelect: (item: DirectoryEntity | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const path = "/api/reports/chargeback/options";
  const query = useQuery<DirectoryResponse>({
    queryKey: [path, kind, debouncedSearch],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ kind, q: debouncedSearch, limit: "8" });
      const response = await fetch(`${path}?${params}`, { credentials: "include", signal });
      if (!response.ok) throw new Error(`Unable to search ${kind}s`);
      return response.json();
    },
    enabled: open,
    staleTime: 0,
  });
  const options = directoryItems(query.data);

  return <div className="relative min-w-[190px]">
    <label className="mb-1 block text-[11px] font-bold text-slate-700">{label}</label>
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
      <Input value={open ? search : selected?.name ?? ""} placeholder={`Search ${kind}s…`}
        onFocus={() => { setSearch(""); setOpen(true); }}
        onChange={event => { setSearch(event.target.value); setOpen(true); }}
        onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}
        className="ff-input h-8 pl-8 text-xs" />
      {selected && <button type="button" aria-label={`Clear ${label}`} onClick={() => { onSelect(null); setSearch(""); }}
        className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-xs text-slate-500 hover:text-slate-900">×</button>}
    </div>
    {open && <div className="ff-reports-surface absolute z-30 mt-1 max-h-52 w-full overflow-y-auto border border-[#808080] bg-[#fffef8] p-1 shadow-md">
      {query.isLoading ? <p className="px-2 py-3 text-xs text-slate-500">Searching directory…</p>
        : query.isError ? <button type="button" onClick={() => void query.refetch()} className="px-2 py-3 text-left text-xs text-red-700">Search failed — retry</button>
        : options.length ? options.map(item => <button key={item.id} type="button" onClick={() => { onSelect(item); setOpen(false); setSearch(""); }}
          className="block w-full px-2 py-1.5 text-left text-xs hover:bg-[#dceef2]">{item.name}</button>)
        : <p className="px-2 py-3 text-xs text-slate-500">No matching {kind}s</p>}
      <button type="button" onClick={() => { onSelect(null); setOpen(false); setSearch(""); }}
        className="mt-1 w-full border-t border-slate-300 px-2 py-1.5 text-left text-[11px] text-slate-600 hover:bg-slate-100">All {kind}s</button>
    </div>}
    {open && <button aria-label="Close search menu" className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} />}
  </div>;
}

function ChargebackTable({
  title, section, rows, totals, kind,
}: {
  title: string;
  section: "chargebacks" | "shortPays" | "deductions";
  rows: ChargebackReportRow[];
  totals: ChargebackReportTotals;
  kind: string;
}) {
  const columns = section === "chargebacks"
    ? ["Date", "Invoice", "Carrier", "Broker", "Original", "Chargeback", "Reason", "Status"]
    : section === "shortPays"
      ? ["Date", "Invoice", "Carrier", "Broker", "Invoice amount", "Cash applied", "Difference", "Outstanding"]
      : ["Date", "Invoice", "Carrier", "Broker", "Kind", "Reason", "Signed amount", "Status"];

  return <section className="overflow-hidden border border-[#808080] bg-[#f4f1e8]">
    <header className="flex items-center justify-between border-b border-[#808080] bg-[#d9e7e9] px-3 py-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[#183b45]">{title}</h3>
      <span className="font-mono text-[11px] text-slate-600">{totals.count} records</span>
    </header>
    <div className="overflow-x-auto">
      <table className="ff-data-table w-full min-w-[980px] text-xs">
        <thead><tr className="border-b border-slate-300 bg-[#e9e6dd] text-left text-[10px] uppercase tracking-wide text-slate-600">
          {columns.map(column => <th key={column} className={cn("whitespace-nowrap px-2.5 py-2", ["Original", "Chargeback", "Invoice amount", "Cash applied", "Difference", "Outstanding", "Signed amount"].includes(column) && "text-right")}>{column}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-200">
          {rows.map(row => <tr key={row.id} className="hover:bg-[#e8f2f1]">
            <td className="whitespace-nowrap px-2.5 py-2 tabular-nums">{formatReportDate(row.date)}</td>
            <td className="whitespace-nowrap px-2.5 py-2 font-semibold text-[#126277]"><Link href={`/invoices/${row.invoiceId}`} className="underline decoration-dotted hover:decoration-solid">{row.invoiceNumber}</Link></td>
            <td className="max-w-[150px] truncate px-2.5 py-2" title={row.carrierName}>{row.carrierName}</td>
            <td className="max-w-[150px] truncate px-2.5 py-2" title={row.brokerName}>{row.brokerName || "—"}</td>
            {section === "chargebacks" && <>
              <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{money(row.originalAmount)}</td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{money(row.amount)}</td>
              <td className="max-w-[220px] px-2.5 py-2">{row.reason || "—"}{row.amount == null && <div className="mt-0.5 text-[10px] text-amber-800">Amount unknown · {row.amountSource}</div>}{row.amount != null && row.amountSource && row.amountSource !== "recorded" && <div className="mt-0.5 text-[10px] text-slate-500">{row.amountSource}</div>}</td>
              <td className="whitespace-nowrap px-2.5 py-2 capitalize">{row.status.replace("_", " ")}</td>
            </>}
            {section === "shortPays" && <>
              <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{money(row.originalAmount)}</td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{money(row.cashApplied)}</td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{money(row.amount)}</td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{money(row.outstanding)}</td>
            </>}
            {section === "deductions" && <>
              <td className="whitespace-nowrap px-2.5 py-2 capitalize">{row.kind || "—"}</td>
              <td className="max-w-[220px] truncate px-2.5 py-2" title={row.reason}>{row.reason || "—"}</td>
              <td className={cn("whitespace-nowrap px-2.5 py-2 text-right tabular-nums", row.amount != null && row.amount < 0 ? "text-[#236344]" : "text-[#963b31]")}>{money(row.amount)}{row.amount != null && <span className="ml-1 text-[10px] text-slate-500">{row.amount < 0 ? "release / credit" : "withheld / charged"}</span>}</td>
              <td className="whitespace-nowrap px-2.5 py-2">{row.status === "applied" ? "Applied" : row.status.replace("_", " ")}</td>
            </>}
          </tr>)}
          {!rows.length && <tr><td colSpan={columns.length} className="px-3 py-7 text-center text-slate-500">No {kind} match these filters.</td></tr>}
        </tbody>
        <tfoot><tr className="border-t-2 border-[#808080] bg-[#e5e1d7] font-bold">
          <td colSpan={4} className="px-2.5 py-2">Section total · {totals.count} rows{totals.unknownAmounts ? ` · ${totals.unknownAmounts} unknown amount${totals.unknownAmounts === 1 ? "" : "s"} excluded` : ""}</td>
          {section === "chargebacks" && <>
            <td className="px-2.5 py-2 text-right tabular-nums">{money(totals.originalAmount)}</td><td className="px-2.5 py-2 text-right tabular-nums">{money(totals.amount)}</td><td colSpan={2} className="px-2.5 py-2 text-right text-[10px] font-normal">Known amounts only</td>
          </>}
          {section === "shortPays" && <>
            <td className="px-2.5 py-2 text-right tabular-nums">{money(totals.originalAmount)}</td><td className="px-2.5 py-2 text-right tabular-nums">{money(totals.cashApplied)}</td><td className="px-2.5 py-2 text-right tabular-nums">{money(totals.amount)}</td><td className="px-2.5 py-2 text-right tabular-nums">{money(totals.outstanding)}</td>
          </>}
          {section === "deductions" && <>
            <td colSpan={2} className="px-2.5 py-2 text-right text-[10px] font-normal">Net signed total</td><td className="px-2.5 py-2 text-right tabular-nums">{money(totals.amount)}</td><td />
          </>}
        </tr></tfoot>
      </table>
    </div>
  </section>;
}

export default function ChargebackReport() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [carrier, setCarrier] = useState<DirectoryEntity | null>(null);
  const [broker, setBroker] = useState<DirectoryEntity | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const errors = useMemo(() => {
    const result: Partial<Record<keyof Filters, string>> = {};
    if (!validDay(filters.startDate)) result.startDate = "Enter a valid date.";
    if (!validDay(filters.endDate)) result.endDate = "Enter a valid date.";
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) result.endDate = "End date must be on or after start date.";
    for (const key of ["minAmount", "maxAmount"] as const) {
      const value = filters[key];
      if (value && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 999999999999.99)) result[key] = "Enter a non-negative amount.";
    }
    if (filters.minAmount && filters.maxAmount && Number(filters.minAmount) > Number(filters.maxAmount)) result.maxAmount = "Maximum must be at least minimum.";
    return result;
  }, [filters]);
  const valid = Object.keys(errors).length === 0;
  const params = useMemo(() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    return query;
  }, [filters]);
  const reportQuery = useQuery<ChargebackReport>({
    queryKey: ["/api/reports/chargeback", filters.startDate, filters.endDate, filters.carrierId, filters.brokerId, filters.status, filters.minAmount, filters.maxAmount],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/reports/chargeback?${params.toString()}`, { credentials: "include", signal });
      if (!response.ok) throw new Error("Unable to load chargeback report");
      return response.json();
    },
    enabled: valid,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const report = reportQuery.data;

  async function exportCsv() {
    if (!valid || reportQuery.isFetching || reportQuery.isError || !report) return;
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch(`/api/reports/chargeback.csv?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("CSV export could not be downloaded.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Trucking_Pros_Financial_chargebacks_${filters.startDate || "all"}_${filters.endDate || "all"}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "CSV export could not be downloaded.");
    } finally {
      setExporting(false);
    }
  }

  const update = (key: keyof Filters, value: string) => setFilters(previous => ({ ...previous, [key]: value }));
  const statusOptions = ["all", "open", "collected", "written_off", "applied"];

  return <div className="space-y-4 text-[#26383b]">
    <div className="border border-[#808080] bg-[#f4f1e8] shadow-[inset_1px_1px_0_#fff]">
      <header className="flex items-center justify-between border-b border-[#808080] bg-[#c9dfe2] px-3 py-2">
        <div><h2 className="text-sm font-bold">Chargeback Reconciliation</h2><p className="mt-0.5 text-[11px] text-slate-600">Actual money movements · Trucking Pros Financial</p></div>
        <Button size="sm" variant="outline" className="h-8 rounded-none border-[#777] bg-[#efede5] text-xs" disabled={!valid || reportQuery.isFetching || reportQuery.isError || !report || exporting} onClick={() => void exportCsv()}>
          <Download className="mr-1.5 h-3.5 w-3.5" />{exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </header>
      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-7">
        <div>
          <label className="mb-1 block text-[11px] font-bold">Start date</label>
          <Input type="date" value={filters.startDate} onChange={event => update("startDate", event.target.value)} className={cn("ff-input h-8 text-xs", errors.startDate && "border-red-600")} />
          {errors.startDate && <p className="mt-1 text-[10px] text-red-700">{errors.startDate}</p>}
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold">End date</label>
          <Input type="date" value={filters.endDate} onChange={event => update("endDate", event.target.value)} className={cn("ff-input h-8 text-xs", errors.endDate && "border-red-600")} />
          {errors.endDate && <p className="mt-1 text-[10px] text-red-700">{errors.endDate}</p>}
        </div>
        <SearchDirectory kind="carrier" label="Carrier" selected={carrier} onSelect={item => { setCarrier(item); update("carrierId", item ? String(item.id) : ""); }} />
        <SearchDirectory kind="broker" label="Broker" selected={broker} onSelect={item => { setBroker(item); update("brokerId", item ? String(item.id) : ""); }} />
        <div>
          <label className="mb-1 block text-[11px] font-bold">Status scope</label>
          <Select value={filters.status} onValueChange={value => update("status", value)}>
            <SelectTrigger className="ff-input h-8 rounded-none text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status === "all" ? "All statuses" : status === "written_off" ? "Written off (chargebacks)" : status === "applied" ? "Applied (deductions)" : status === "open" ? "Open (chargebacks & short pays)" : "Collected (chargebacks)"}</SelectItem>)}</SelectContent>
          </Select>
          <p className="mt-1 text-[9px] leading-tight text-slate-500">Open also filters short pays; applied filters deductions.</p>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold">Minimum $</label>
          <Input inputMode="decimal" value={filters.minAmount} onChange={event => update("minAmount", event.target.value)} placeholder="No minimum" className={cn("ff-input h-8 text-xs", errors.minAmount && "border-red-600")} />
          {errors.minAmount && <p className="mt-1 text-[10px] text-red-700">{errors.minAmount}</p>}
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold">Maximum $</label>
          <Input inputMode="decimal" value={filters.maxAmount} onChange={event => update("maxAmount", event.target.value)} placeholder="No maximum" className={cn("ff-input h-8 text-xs", errors.maxAmount && "border-red-600")} />
          {errors.maxAmount && <p className="mt-1 text-[10px] text-red-700">{errors.maxAmount}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-300 px-3 py-2 text-[10px] text-slate-600">
        <span>Deduction amount range uses absolute dollars; signed values distinguish withholding from credits.</span>
        <button type="button" onClick={() => { setFilters(initialFilters); setCarrier(null); setBroker(null); }}
          className="inline-flex items-center gap-1 font-bold text-[#126277] hover:underline"><RefreshCw className="h-3 w-3" />Reset filters</button>
      </div>
    </div>

    {exportError && <p role="alert" className="border border-red-400 bg-red-50 px-3 py-2 text-xs text-red-800">{exportError}</p>}
    {!valid ? <div className="border border-amber-500 bg-amber-50 p-5 text-center text-xs text-amber-900">Correct the highlighted filters to run or export this report.</div>
      : reportQuery.isLoading ? <div className="space-y-3" aria-label="Loading report">
        {[0, 1, 2].map(item => <div key={item} className="h-32 animate-pulse border border-[#aaa] bg-[#e8e5dc]" />)}
      </div>
      : reportQuery.isError ? <div role="alert" className="border border-red-400 bg-red-50 p-6 text-center">
        <FileWarning className="mx-auto mb-2 h-5 w-5 text-red-700" /><p className="text-sm font-bold text-red-800">Report could not be loaded</p>
        <p className="mt-1 text-xs text-red-700">No export is available until the displayed filter set loads successfully.</p>
        <Button variant="outline" size="sm" className="mt-3 rounded-none" onClick={() => void reportQuery.refetch()}>Retry</Button>
      </div>
      : report && <>
        {report.notices?.length > 0 && <aside className="border border-[#b5a878] bg-[#fff8dc] px-3 py-2 text-[11px] text-[#51482c]">
          <strong className="mr-1">Accounting notes:</strong>{report.notices.join(" ")}
        </aside>}
        <ChargebackTable title="Chargebacks" section="chargebacks" kind="chargebacks" rows={report.chargebacks} totals={report.totals.chargebacks} />
        <ChargebackTable title="Short Pays" section="shortPays" kind="short pays" rows={report.shortPays} totals={report.totals.shortPays} />
        <ChargebackTable title="Deductions" section="deductions" kind="deductions" rows={report.deductions} totals={report.totals.deductions} />
        <p className="border-t border-[#808080] bg-[#e5e1d7] px-3 py-2 text-[10px] text-slate-600">Section totals are intentionally separate: chargebacks and short pays can describe the same short-paid invoice and must not be added together. Unknown chargeback amounts are excluded from amount totals, not treated as zero.</p>
      </>}
  </div>;
}
