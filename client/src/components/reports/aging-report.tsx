import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileWarning, RefreshCw, Search } from "lucide-react";
import { Link } from "wouter";
import {
  AGING_COLUMNS,
  agingReportCsv,
  agingReportFiltersSchema,
  type AgingReportFilters,
  type GroupedAgingReport,
} from "@shared/aging-report";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmationStatusBadge, type ConfirmationStatus } from "@/components/broker-confirmation/confirmation-status";
import { Win95Tabs, Win95TabsList, Win95TabsTrigger } from "@/components/win95";

type FilterState = {
  search: string;
  startDate: string;
  endDate: string;
  minAmount: string;
  maxAmount: string;
  status: "all" | "funded" | "held";
  loadType: "all" | "otr_load" | "dump_truck_ticket" | "hotshot" | "other";
};

const initialFilters: FilterState = {
  search: "",
  startDate: "",
  endDate: "",
  minAmount: "",
  maxAmount: "",
  status: "all",
  loadType: "all",
};

function money(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fundedDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function saveCsv(report: GroupedAgingReport, filters: AgingReportFilters) {
  const blob = new Blob([agingReportCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `Trucking_Pros_Financial_aging_${filters.view}_${filters.startDate ?? "all"}_${filters.endDate ?? "all"}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function moneyFieldError(value: unknown) {
  if (value === "" || value == null) return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Enter a valid amount.";
  if (amount < 0) return "Amount cannot be negative.";
  if (amount > 999999999999.99) return "Amount is above the supported limit.";
  return undefined;
}

export default function AgingReport() {
  const [view, setView] = useState<"carrier" | "broker">("carrier");
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const parsedFilters = useMemo(() => agingReportFiltersSchema.safeParse({
    ...filters,
    view,
  }), [filters, view]);
  const validFilters = parsedFilters.success ? parsedFilters.data : undefined;
  const fieldErrors = useMemo(() => {
    if (parsedFilters.success) return {} as Record<string, string>;
    return parsedFilters.error.issues.reduce<Record<string, string>>((errors, issue) => {
      const field = String(issue.path[0] ?? "filters");
      errors[field] ??= issue.message;
      return errors;
    }, {});
  }, [parsedFilters]);
  const reportQuery = useQuery<GroupedAgingReport>({
    queryKey: ["/api/reports/aging", validFilters],
    queryFn: async ({ signal }) => {
      if (!validFilters) throw new Error("Correct the highlighted filters before loading the report.");
      const params = new URLSearchParams();
      Object.entries(validFilters).forEach(([key, value]) => {
        if (value !== undefined && value !== "") params.set(key, String(value));
      });
      const response = await fetch(`/api/reports/aging?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!response.ok) throw new Error("Unable to load the aging report. Please try again.");
      return response.json();
    },
    enabled: Boolean(validFilters),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const report = reportQuery.data;
  const showLoading = Boolean(validFilters) && (reportQuery.isLoading || reportQuery.isFetching);
  const update = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters(previous => ({ ...previous, [key]: value }));
  };
  const changeView = (next: string) => {
    if (next !== "carrier" && next !== "broker") return;
    setView(next);
    setFilters(previous => ({ ...previous, search: "" }));
  };
  const exportBlocked = !validFilters || reportQuery.isFetching || reportQuery.isError || !report;
  const entityLabel = view === "carrier" ? "Carrier" : "Broker";

  return (
    <section className="space-y-3 text-[#26383b]" aria-labelledby="aging-report-title">
      <div className="overflow-hidden border-2 border-[#808080] border-r-[#404040] border-b-[#404040] bg-[#f4f1e8] shadow-[inset_1px_1px_0_#fff]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#808080] bg-[#c9dfe2] px-3 py-2">
          <div>
            <h2 id="aging-report-title" className="text-sm font-bold">Aging Report</h2>
            <p className="mt-0.5 text-[11px] text-slate-600">Receivables aged from the funded date, using the America/Denver calendar.</p>
          </div>
          <Button
            data-testid="aging-export"
            size="sm"
            variant="outline"
            className="h-8 rounded-none border-[#777] bg-[#efede5] text-xs"
            disabled={exportBlocked}
            onClick={() => report && validFilters && saveCsv(report, validFilters)}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
          </Button>
        </header>

        <div className="border-b border-[#808080] bg-[#e9e6dd] px-3 pt-2">
          <Win95Tabs value={view} onValueChange={changeView}>
            <Win95TabsList aria-label="Group aging report">
              <Win95TabsTrigger value="carrier" data-testid="aging-view-carrier">By Carrier</Win95TabsTrigger>
              <Win95TabsTrigger value="broker" data-testid="aging-view-broker">By Broker</Win95TabsTrigger>
            </Win95TabsList>
          </Win95Tabs>
        </div>

        <div className="grid gap-x-3 gap-y-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="aging-entity-search" className="mb-1 block text-[11px] font-bold">{entityLabel} name</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <Input
                id="aging-entity-search"
                data-testid="aging-entity-search"
                value={filters.search}
                maxLength={200}
                onChange={event => update("search", event.target.value)}
                placeholder={`Search ${entityLabel.toLowerCase()}s`}
                aria-invalid={Boolean(fieldErrors.search)}
                aria-describedby={fieldErrors.search ? "aging-search-error" : undefined}
                className="ff-input h-8 rounded-none pl-8 text-xs"
              />
            </div>
            {fieldErrors.search && <p id="aging-search-error" className="mt-1 text-[10px] text-red-700">{fieldErrors.search}</p>}
          </div>
          <div>
            <label htmlFor="aging-start-date" className="mb-1 block text-[11px] font-bold">Funded from</label>
            <Input id="aging-start-date" data-testid="aging-start-date" type="date" value={filters.startDate}
              onChange={event => update("startDate", event.target.value)} aria-invalid={Boolean(fieldErrors.startDate)}
              aria-describedby={fieldErrors.startDate ? "aging-start-error" : undefined}
              className="ff-input h-8 rounded-none text-xs" />
            {fieldErrors.startDate && <p id="aging-start-error" className="mt-1 text-[10px] text-red-700">{fieldErrors.startDate}</p>}
          </div>
          <div>
            <label htmlFor="aging-end-date" className="mb-1 block text-[11px] font-bold">Funded through</label>
            <Input id="aging-end-date" data-testid="aging-end-date" type="date" value={filters.endDate}
              onChange={event => update("endDate", event.target.value)} aria-invalid={Boolean(fieldErrors.endDate)}
              aria-describedby={fieldErrors.endDate ? "aging-end-error" : undefined}
              className="ff-input h-8 rounded-none text-xs" />
            {fieldErrors.endDate && <p id="aging-end-error" className="mt-1 text-[10px] text-red-700">{fieldErrors.endDate}</p>}
          </div>
          <div>
            <label htmlFor="aging-status" className="mb-1 block text-[11px] font-bold">Invoice status</label>
            <select id="aging-status" data-testid="aging-status" value={filters.status}
              onChange={event => update("status", event.target.value as FilterState["status"])}
              className="ff-input h-8 w-full rounded-none px-2 text-xs">
              <option value="all">All eligible statuses</option>
              <option value="funded">Funded</option>
              <option value="held">Held</option>
            </select>
          </div>
          <div>
            <label htmlFor="aging-min-amount" className="mb-1 block text-[11px] font-bold">Min outstanding</label>
            <Input id="aging-min-amount" data-testid="aging-min-amount" inputMode="decimal" value={filters.minAmount}
              onChange={event => update("minAmount", event.target.value)} placeholder="No minimum"
              aria-invalid={Boolean(fieldErrors.minAmount)} aria-describedby={fieldErrors.minAmount ? "aging-min-error" : undefined}
              className="ff-input h-8 rounded-none text-xs" />
            {(fieldErrors.minAmount || moneyFieldError(filters.minAmount)) && <p id="aging-min-error" className="mt-1 text-[10px] text-red-700">{fieldErrors.minAmount || moneyFieldError(filters.minAmount)}</p>}
          </div>
          <div>
            <label htmlFor="aging-max-amount" className="mb-1 block text-[11px] font-bold">Max outstanding</label>
            <Input id="aging-max-amount" data-testid="aging-max-amount" inputMode="decimal" value={filters.maxAmount}
              onChange={event => update("maxAmount", event.target.value)} placeholder="No maximum"
              aria-invalid={Boolean(fieldErrors.maxAmount)} aria-describedby={fieldErrors.maxAmount ? "aging-max-error" : undefined}
              className="ff-input h-8 rounded-none text-xs" />
            {(fieldErrors.maxAmount || moneyFieldError(filters.maxAmount)) && <p id="aging-max-error" className="mt-1 text-[10px] text-red-700">{fieldErrors.maxAmount || moneyFieldError(filters.maxAmount)}</p>}
          </div>
          <div>
            <label htmlFor="aging-load-type" className="mb-1 block text-[11px] font-bold">Load type</label>
            <select id="aging-load-type" data-testid="aging-load-type" value={filters.loadType}
              onChange={event => update("loadType", event.target.value as FilterState["loadType"])}
              className="ff-input h-8 w-full rounded-none px-2 text-xs">
              <option value="all">All load types</option>
              <option value="otr_load">OTR</option>
              <option value="dump_truck_ticket">Dump</option>
              <option value="hotshot">Hotshot</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex items-end justify-end">
            <Button type="button" data-testid="aging-reset" variant="outline" size="sm"
              className="h-8 rounded-none border-[#888] bg-[#efede5] text-xs"
              onClick={() => setFilters(initialFilters)}>
              <RefreshCw className="mr-1.5 h-3 w-3" /> Reset filters
            </Button>
          </div>
        </div>
        <p className="border-t border-slate-300 bg-[#efede5] px-3 py-2 text-[10px] leading-relaxed text-slate-600">
          Only funded or held invoices with a funded date and positive outstanding balance are included. “All eligible statuses” means Funded and Held only. Current is funding day 0; 90+ begins on day 91.
        </p>
      </div>

      {!parsedFilters.success ? (
        <div data-testid="aging-validation-error" role="alert" className="border border-amber-600 bg-[#fff3cc] px-4 py-3 text-xs text-[#604b16]">
          Correct the highlighted filters to load this report.
        </div>
      ) : showLoading ? (
        <div data-testid="aging-loading" aria-label="Loading aging report" className="overflow-hidden border border-[#808080] bg-[#f4f1e8]">
          <div className="h-9 animate-pulse border-b border-[#808080] bg-[#dce6e3]" />
          {[0, 1, 2, 3].map(row => <div key={row} className="h-10 animate-pulse border-b border-slate-200 bg-[#ebe8df]" />)}
        </div>
      ) : reportQuery.isError ? (
        <div data-testid="aging-error" role="alert" className="border border-red-500 bg-[#fff0ed] p-6 text-center">
          <FileWarning className="mx-auto mb-2 h-5 w-5 text-red-700" />
          <p className="text-sm font-bold text-red-800">Aging report could not be loaded</p>
          <p className="mt-1 text-xs text-red-700">{reportQuery.error instanceof Error ? reportQuery.error.message : "An unexpected error occurred."} No export is available until these filters load successfully.</p>
          <Button data-testid="aging-retry" variant="outline" size="sm" className="mt-3 rounded-none"
            onClick={() => void reportQuery.refetch()}>Retry</Button>
        </div>
      ) : report ? (
        <>
          <section data-testid="aging-grouped-table" aria-label={`${view === "carrier" ? "Carrier" : "Broker"} aging totals`}
            className="overflow-hidden border-2 border-[#808080] border-r-[#404040] border-b-[#404040] bg-[#f4f1e8]">
            <header className="flex items-center justify-between border-b border-[#808080] bg-[#d9e7e9] px-3 py-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#183b45]">Aging by {view}</h3>
              <span className="font-mono text-[11px] text-slate-600">{report.totals.invoiceCount.toLocaleString()} invoices</span>
            </header>
            <div className="overflow-x-auto">
              <table className="ff-data-table w-full min-w-[830px] text-xs">
                <thead><tr className="border-b border-slate-300 bg-[#e9e6dd] text-left text-[10px] uppercase tracking-wide text-slate-600">
                  <th scope="col" className="min-w-[190px] px-3 py-2">{entityLabel}</th>
                  <th scope="col" className="px-3 py-2 text-right">Invoices</th>
                  {AGING_COLUMNS.map(column => <th key={column.key} scope="col" className="whitespace-nowrap px-3 py-2 text-right">{column.label}</th>)}
                  <th scope="col" className="px-3 py-2 text-right">Total</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-200">
                  {report.rows.map(row => <tr key={row.id} data-testid="aging-group-row" className="hover:bg-[#e8f2f1]">
                    <th scope="row" className="max-w-[290px] truncate px-3 py-2 text-left font-semibold" title={row.name}>{row.name}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{row.invoiceCount.toLocaleString()}</td>
                    {AGING_COLUMNS.map(column => <td key={column.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(row.buckets[column.key])}</td>)}
                    <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums">{money(row.total)}</td>
                  </tr>)}
                  {!report.rows.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No eligible receivables match these filters.</td></tr>}
                </tbody>
                <tfoot><tr className="border-t-2 border-[#808080] bg-[#e5e1d7] font-bold" data-testid="aging-grand-total">
                  <th scope="row" className="px-3 py-2 text-left">Total</th>
                  <td className="px-3 py-2 text-right tabular-nums">{report.totals.invoiceCount.toLocaleString()}</td>
                  {AGING_COLUMNS.map(column => <td key={column.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(report.totals.buckets[column.key])}</td>)}
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(report.totals.total)}</td>
                </tr></tfoot>
              </table>
            </div>
          </section>

          <section data-testid="confirmation-aging-table" className="overflow-hidden border-2 border-[#808080] border-r-[#404040] border-b-[#404040] bg-[#f4f1e8]">
            <header className="border-b border-[#808080] bg-[#d9e7e9] px-3 py-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#183b45]">Invoice Funding &amp; Broker Confirmation</h3>
              <p className="mt-0.5 text-[10px] text-slate-600">Invoice details match the filters and eligible receivables in the grouped report above.</p>
            </header>
            <div className="overflow-x-auto">
              <table className="ff-data-table w-full min-w-[940px] text-xs">
                <thead><tr className="border-b border-slate-300 bg-[#e9e6dd] text-left text-[10px] uppercase tracking-wide text-slate-600">
                  {["Invoice", "Carrier", "Broker", "Amount", "Outstanding", "Age", "Funded", "Confirmation status"].map((label, index) =>
                    <th key={label} scope="col" className={`whitespace-nowrap px-3 py-2 ${index === 3 || index === 4 ? "text-right" : ""}`}>{label}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-200">
                  {report.invoices.map(invoice => <tr key={invoice.invoiceId} data-testid="confirmation-aging-row" className="hover:bg-[#e8f2f1]">
                    <td className="px-3 py-2 font-semibold text-[#126277]"><Link href={`/invoices/${invoice.invoiceId}`} className="underline decoration-dotted hover:decoration-solid">{invoice.invoiceNumber}</Link></td>
                    <td className="max-w-[180px] truncate px-3 py-2" title={invoice.carrier ?? ""}>{invoice.carrier || "—"}</td>
                    <td className="max-w-[180px] truncate px-3 py-2" title={invoice.broker ?? ""}>{invoice.broker || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(Number(invoice.amount))}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(Number(invoice.outstanding))}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{invoice.ageDays}d</td>
                    <td className="whitespace-nowrap px-3 py-2">{fundedDate(invoice.fundedAt)}</td>
                    <td className="px-3 py-2"><ConfirmationStatusBadge status={invoice.confirmationStatus as ConfirmationStatus} /></td>
                  </tr>)}
                  {!report.invoices.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No eligible invoice details match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
