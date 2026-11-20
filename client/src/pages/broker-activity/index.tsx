import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import Sidebar from "@/components/layout/sidebar";
import {
  AdminPageShell,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  SelectContent,
  SelectTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TopNav,
} from "@/components/admin-neu/adapters";
import { Select, SelectItem, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowDownToLine, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Info, RotateCw, Search, X } from "lucide-react";
import type { BrokerActivityFilters, BrokerActivityRow } from "@shared/broker-activity";
import "@/components/admin-neu/admin-neu-page.css";
import {
  useBrokerActivity,
  useBrokerActivityCsv,
  useBrokerActivityStats,
  useBrokerOptions,
  useBrokerResponseReport,
} from "./hooks";

const PAGE_SIZE = 15;
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function money(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
    : "—";
}

function dateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function duration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr${hours === 1 ? "" : "s"}${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}${hours % 24 ? ` ${hours % 24} hr` : ""}`;
}

function statusText(status: BrokerActivityRow["status"]) {
  return status === "confirmed" ? "Confirmed" : status === "disputed" ? "Disputed" : "Pending";
}

function statusTone(status: BrokerActivityRow["status"]) {
  return status === "confirmed" ? "success" : "warning";
}

function StatCard({ label, value, detail, icon, loading }: { label: string; value: string | number; detail?: string; icon: ReactNode; loading?: boolean }) {
  return (
    <Card className="ff-broker-activity-surface">
      <CardContent className="flex min-h-[124px] items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
          {loading ? (
            <div className="mt-3 space-y-2" aria-label={`Loading ${label}`}>
              <div className="h-7 w-20 animate-pulse rounded-md bg-black/5" />
              <div className="h-3 w-28 animate-pulse rounded bg-black/5" />
            </div>
          ) : (
            <>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
              {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
            </>
          )}
        </div>
        <span className="admin-neu-surface rounded-xl p-2.5 text-muted-foreground">{icon}</span>
      </CardContent>
    </Card>
  );
}

function LoadingRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <TableRow key={index}>
          <TableCell colSpan={columns}>
            <div className="h-5 animate-pulse rounded-lg bg-black/5" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default function BrokerActivityPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const canManage = user?.role === "admin" || user?.role === "manager";
  const [section, setSection] = useState<"activity" | "report">("activity");
  const [filters, setFilters] = useState<BrokerActivityFilters>({
    status: "all",
    method: "all",
    page: 1,
    timeZone,
  });
  const [searchDraft, setSearchDraft] = useState("");
  const [brokerPickerOpen, setBrokerPickerOpen] = useState(false);
  const [brokerSearchDraft, setBrokerSearchDraft] = useState("");
  const [brokerSearch, setBrokerSearch] = useState("");
  const [brokerPage, setBrokerPage] = useState(1);
  const [selectedBrokerName, setSelectedBrokerName] = useState("");
  const dateRangeInvalid = Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => current.search === searchDraft.trim()
        ? current
        : { ...current, search: searchDraft.trim() || undefined, page: 1 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBrokerSearch(brokerSearchDraft.trim());
      setBrokerPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [brokerSearchDraft]);

  const activity = useBrokerActivity(filters, Boolean(canManage && !dateRangeInvalid));
  const stats = useBrokerActivityStats(filters, Boolean(canManage && !dateRangeInvalid));
  const report = useBrokerResponseReport(filters, Boolean(canManage && section === "report" && !dateRangeInvalid));
  const brokers = useBrokerOptions(brokerSearch, brokerPage, Boolean(canManage && brokerPickerOpen));
  const exportCsv = useBrokerActivityCsv();

  const pageCount = Math.max(1, Math.ceil((activity.data?.total ?? 0) / (activity.data?.pageSize ?? PAGE_SIZE)));
  const reportPageCount = Math.max(1, Math.ceil((report.data?.total ?? 0) / (report.data?.pageSize ?? PAGE_SIZE)));
  const activityData = dateRangeInvalid ? undefined : activity.data;
  const statsData = dateRangeInvalid ? undefined : stats.data;
  const reportData = dateRangeInvalid ? undefined : report.data;
  const setFilter = <K extends keyof BrokerActivityFilters>(key: K, value: BrokerActivityFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  };

  const reportFilters = useMemo(() => ({ ...filters, page: filters.page ?? 1 }), [filters]);

  const downloadReport = () => {
    exportCsv.mutate(reportFilters, {
      onSuccess: (blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = `broker-response-report-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      },
    });
  };

  if (!canManage) {
    return (
      <div className="ff-admin-page flex min-h-[100dvh] overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopNav title="Broker Activity" subtitle="Broker invoice response operations" group="Admin" />
          <AdminPageShell className="flex flex-1 items-center justify-center p-6">
            <Card className="max-w-lg p-6 text-center">
              <p className="font-semibold">Access restricted</p>
              <p className="mt-2 text-sm text-muted-foreground">Broker activity is available to administrators and managers.</p>
            </Card>
          </AdminPageShell>
        </div>
      </div>
    );
  }

  return (
    <div className="ff-admin-page flex min-h-[100dvh] overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav title="Broker Activity" subtitle="Invoice responses, approval amounts, and broker performance" group="Admin" />
        <AdminPageShell className="flex-1 !min-h-0 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto w-full max-w-[1680px] space-y-5">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Operations / Brokers</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">Broker Activity</h1>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">A single invoice-level record of broker responses and outstanding approvals.</p>
              </div>
              <div className="flex w-fit rounded-xl p-1" role="tablist" aria-label="Broker activity views">
                <button type="button" role="tab" aria-selected={section === "activity"} onClick={() => { setSection("activity"); setFilters(current => ({ ...current, page: 1 })); }} className={`min-h-10 rounded-lg px-4 text-sm font-semibold transition-colors ${section === "activity" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Action log</button>
                <button type="button" role="tab" aria-selected={section === "report"} onClick={() => { setSection("report"); setFilters(current => ({ ...current, page: 1 })); }} className={`min-h-10 rounded-lg px-4 text-sm font-semibold transition-colors ${section === "report" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Response report</button>
              </div>
            </header>

            <section aria-label="Broker response statistics">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Today at a glance</h2>
                <p className="text-xs text-muted-foreground">Today is calculated in {statsData?.timeZone || timeZone}. Totals ignore the selected status; pending and today’s confirmed/disputed cards cover those statuses.</p>
              </div>
              {dateRangeInvalid && <p role="alert" className="mb-3 rounded-xl p-3 text-sm text-destructive admin-neu-surface">Invalid date range: “From” must be on or before “To”. Matching results are hidden until corrected.</p>}
              {stats.isError && !statsData && !dateRangeInvalid && (
                <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 text-sm text-destructive admin-neu-surface">
                  <span>Could not load activity totals.</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => stats.refetch()}>Retry</Button>
                </div>
              )}
              {stats.isError && statsData && <p className="mb-3 text-xs text-destructive" role="status">Totals could not be refreshed; showing the last available values.</p>}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Pending approvals" value={statsData?.pendingCount ?? "—"} detail="Awaiting broker response" icon={<Clock3 className="h-5 w-5 text-amber-700" />} loading={stats.isLoading && !dateRangeInvalid} />
                <StatCard label="Confirmed today" value={statsData ? statsData.confirmedTodayCount.toLocaleString() : "—"} detail={statsData ? money(statsData.confirmedTodayAmount) : "Today’s confirmed amount"} icon={<Check className="h-5 w-5 text-emerald-700" />} loading={stats.isLoading && !dateRangeInvalid} />
                <StatCard label="Disputed today" value={statsData ? statsData.disputedTodayCount.toLocaleString() : "—"} detail={statsData ? money(statsData.disputedTodayAmount) : "Today’s disputed amount"} icon={<AlertTriangle className="h-5 w-5 text-destructive" />} loading={stats.isLoading && !dateRangeInvalid} />
                <StatCard label="Average response" value={statsData ? duration(statsData.averageResponseSeconds) : "—"} detail="First sent to broker response" icon={<RotateCw className="h-5 w-5" />} loading={stats.isLoading && !dateRangeInvalid} />
              </div>
            </section>

            <Card className="ff-broker-activity-surface">
              <CardContent className="space-y-4 p-4 md:p-5">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                  <div className="relative w-full xl:max-w-[250px]">
                    <label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor="broker-filter">Broker</label>
                    <button
                      id="broker-filter"
                      type="button"
                      className="admin-neu-button flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]"
                      aria-expanded={brokerPickerOpen}
                      onClick={() => setBrokerPickerOpen((open) => !open)}
                    >
                      <span className="truncate">{filters.brokerId ? selectedBrokerName || "Selected broker" : "All brokers"}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                    </button>
                    {brokerPickerOpen && (
                      <div className="admin-neu-surface absolute z-30 mt-2 w-full min-w-[280px] rounded-2xl p-3">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input value={brokerSearchDraft} onChange={(event) => setBrokerSearchDraft(event.target.value)} placeholder="Search all brokers…" className="pl-9" aria-label="Search brokers" />
                        </div>
                        <div className="mt-2 max-h-56 overflow-y-auto">
                          <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setFilters((current) => ({ ...current, brokerId: undefined, page: 1 })); setSelectedBrokerName(""); setBrokerPickerOpen(false); }}>All brokers</button>
                          {brokers.isLoading && <div className="space-y-2 p-2"><div className="h-7 animate-pulse rounded bg-muted" /><div className="h-7 animate-pulse rounded bg-muted" /></div>}
                          {brokers.isError && <div className="p-2 text-xs text-destructive" role="alert">Broker list unavailable. <button type="button" className="underline" onClick={() => brokers.refetch()}>Retry</button></div>}
                          {brokers.data?.brokers.map((broker) => (
                            <button key={broker.id} type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setFilters((current) => ({ ...current, brokerId: broker.id, page: 1 })); setSelectedBrokerName(broker.name); setBrokerPickerOpen(false); }}>
                              {broker.name}
                            </button>
                          ))}
                          {brokers.data && brokers.data.brokers.length === 0 && <p className="p-3 text-sm text-muted-foreground">No brokers match that search.</p>}
                        </div>
                        {brokers.data && brokers.data.total > 0 && (
                          <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-2 text-xs text-muted-foreground">
                            <span>{brokers.data.total.toLocaleString()} brokers · Page {brokers.data.page} of {Math.max(1, Math.ceil(brokers.data.total / brokers.data.pageSize))}</span>
                            <div className="flex gap-1">
                              <Button type="button" size="icon" variant="ghost" aria-label="Previous broker page" disabled={brokerPage <= 1 || brokers.isFetching} onClick={() => setBrokerPage((page) => Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4" /></Button>
                              <Button type="button" size="icon" variant="ghost" aria-label="Next broker page" disabled={brokerPage >= Math.ceil(brokers.data.total / brokers.data.pageSize) || brokers.isFetching} onClick={() => setBrokerPage((page) => page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="w-full sm:w-[170px]">
                    <label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor="activity-status">Status</label>
                    <Select disabled={section === "report"} value={section === "report" ? "all" : filters.status || "all"} onValueChange={(value) => setFilter("status", value as BrokerActivityFilters["status"])}>
                      <SelectTrigger id="activity-status" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="disputed">Disputed</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="w-full sm:w-[150px]">
                    <label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor="activity-method">Method</label>
                    <Select value={filters.method || "all"} onValueChange={(value) => setFilter("method", value as BrokerActivityFilters["method"])}>
                      <SelectTrigger id="activity-method" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">All methods</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="portal">Portal</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="grid w-full grid-cols-2 gap-2 sm:max-w-[320px]">
                    <div><label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor="activity-from">From</label><Input id="activity-from" type="date" aria-invalid={dateRangeInvalid} value={filters.dateFrom || ""} onChange={(event) => setFilter("dateFrom", event.target.value || undefined)} /></div>
                    <div><label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor="activity-to">To</label><Input id="activity-to" type="date" aria-invalid={dateRangeInvalid} value={filters.dateTo || ""} onChange={(event) => setFilter("dateTo", event.target.value || undefined)} /></div>
                  </div>
                  {dateRangeInvalid && <p role="alert" className="text-xs text-destructive xl:pb-2">From must be on or before To.</p>}
                  <div className="w-full xl:min-w-[230px] xl:flex-1">
                    <label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor="activity-search">Invoice or client</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input id="activity-search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search invoice # or client" className="pl-9 pr-9" />
                      {searchDraft && <button type="button" aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground" onClick={() => setSearchDraft("")}><X className="h-4 w-4" /></button>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                  <span>Action-log dates use the response action date, otherwise the recorded sent date; pending rows without a recorded sent timestamp may qualify by funded/submitted date. Dates shown in {timeZone}.</span>
                  {activity.isFetching && <span role="status">Refreshing results…</span>}
                </div>
              </CardContent>
            </Card>

            {section === "activity" ? (
              <Card className="ff-broker-activity-surface">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Broker actions log</CardTitle>
                    <CardDescription className="mt-1">One row per invoice; latest broker action first.</CardDescription>
                  </div>
                  {activity.isError && activity.data && <span role="status" className="text-xs text-destructive">Refresh failed; showing last loaded results.</span>}
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table className="min-w-[1260px]">
                      <TableHeader><TableRow>
                        <TableHead>Invoice #</TableHead><TableHead>Broker</TableHead><TableHead>Client</TableHead>
                        <TableHead className="text-right">Invoice amount</TableHead><TableHead className="text-right">Approved amount</TableHead>
                        <TableHead>Status</TableHead><TableHead>Action / sent date</TableHead><TableHead>Response time</TableHead><TableHead>Method</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {dateRangeInvalid && <TableRow><TableCell colSpan={9} className="py-12 text-center"><p className="font-semibold text-destructive">Invalid date range</p><p className="mt-1 text-sm text-muted-foreground">Correct the date filters to view matching invoice actions.</p></TableCell></TableRow>}
                        {!dateRangeInvalid && activity.isLoading && <LoadingRows columns={9} />}
                        {!dateRangeInvalid && !activity.isLoading && activity.isError && !activityData && (
                          <TableRow><TableCell colSpan={9} className="py-12 text-center">
                            <p className="text-sm text-destructive">Could not load broker actions.</p>
                            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => activity.refetch()}>Retry</Button>
                          </TableCell></TableRow>
                        )}
                        {!dateRangeInvalid && !activity.isLoading && !activity.isError && (activityData?.items.length ?? 0) === 0 && (
                          <TableRow><TableCell colSpan={9} className="py-14 text-center">
                            <div className="mx-auto max-w-sm"><p className="font-semibold">No broker actions match</p><p className="mt-1 text-sm text-muted-foreground">Adjust the filters or date range to view other invoice responses.</p></div>
                          </TableCell></TableRow>
                        )}
                        {activityData?.items.map((row) => (
                          <TableRow
                            key={row.invoiceId}
                            className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#27aab8]"
                            role="link"
                            tabIndex={0}
                            aria-label={`Open invoice ${row.invoiceNumber}`}
                            onClick={() => setLocation(`/invoices/${row.invoiceId}`)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setLocation(`/invoices/${row.invoiceId}`);
                              }
                            }}
                          >
                            <TableCell className="font-semibold text-primary">{row.invoiceNumber || `#${row.invoiceId}`}</TableCell>
                            <TableCell>{row.brokerName || "—"}</TableCell>
                            <TableCell>{row.clientName || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(row.invoiceAmount)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span className="inline-flex items-center justify-end gap-1.5">
                                {money(row.approvedAmount)}
                                {row.discrepancy && <span className="cursor-help text-amber-700" aria-label="Approved amount differs from invoice amount" title="Approved amount differs from invoice amount"><AlertTriangle className="h-4 w-4" aria-hidden="true" /></span>}
                                {row.historicalAmount && <span className="cursor-help text-muted-foreground" aria-label="Historical amount reconstructed" title="This approved amount was reconstructed from the invoice’s current total; it is not a historical snapshot."><Info className="h-4 w-4" aria-hidden="true" /></span>}
                              </span>
                            </TableCell>
                            <TableCell>{row.status === "disputed"
                              ? <span className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">Disputed</span>
                              : <Badge tone={statusTone(row.status)}>{statusText(row.status)}</Badge>}</TableCell>
                            <TableCell>{dateTime(row.status === "pending" ? row.sentAt : row.actedAt || row.sentAt)}</TableCell>
                            <TableCell className="tabular-nums">{duration(row.responseSeconds)}</TableCell>
                            <TableCell>{row.method === "email" ? "Email" : row.method === "portal" ? "Portal" : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm">
                    <span className="text-muted-foreground">{dateRangeInvalid ? "Correct the date range to see matching invoices." : `${(activityData?.total ?? 0).toLocaleString()} invoices · Page ${filters.page ?? 1} of ${pageCount}`}</span>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={dateRangeInvalid || (filters.page ?? 1) <= 1 || activity.isFetching} onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, (current.page ?? 1) - 1) }))}>Previous</Button>
                      <Button type="button" variant="outline" size="sm" disabled={dateRangeInvalid || (filters.page ?? 1) >= pageCount || activity.isFetching} onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}>Next</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="ff-broker-activity-surface">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Broker response report</CardTitle>
                    <CardDescription className="mt-1">Response outcomes grouped by broker. Only invoices with a recorded first-sent timestamp are included; the date range filters that timestamp. All response statuses contribute to each broker’s totals.</CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    {report.isFetching && <span role="status" className="text-xs text-muted-foreground">Refreshing…</span>}
                    <Button type="button" variant="outline" disabled={dateRangeInvalid || exportCsv.isPending} onClick={downloadReport}>
                      <ArrowDownToLine className="h-4 w-4" />{exportCsv.isPending ? "Preparing CSV…" : "Export full CSV"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {exportCsv.isError && <p role="alert" className="px-5 pb-3 text-sm text-destructive">Could not export the filtered report. Please try again.</p>}
                  {dateRangeInvalid && <div role="alert" className="p-10 text-center"><p className="font-semibold text-destructive">Invalid date range</p><p className="mt-1 text-sm text-muted-foreground">Correct the date filters to view matching broker cohorts.</p></div>}
                  {!dateRangeInvalid && report.isError && !reportData && (
                    <div className="p-10 text-center"><p className="text-sm text-destructive">Could not load broker response report.</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => report.refetch()}>Retry</Button></div>
                  )}
                  {!dateRangeInvalid && report.isError && reportData && <p role="status" className="px-5 pb-3 text-xs text-destructive">Report refresh failed; showing last loaded results.</p>}
                  <div className="overflow-x-auto">
                    <Table className="min-w-[1060px]">
                      <TableHeader><TableRow>
                        <TableHead>Broker name</TableHead><TableHead className="text-right">Total invoices sent</TableHead>
                        <TableHead className="text-right">Confirmed</TableHead><TableHead className="text-right">Disputed</TableHead>
                        <TableHead className="text-right">No response</TableHead><TableHead>Average response time</TableHead><TableHead className="text-right">Confirmation rate</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {dateRangeInvalid && <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Correct the date range to view matching report rows.</TableCell></TableRow>}
                        {!dateRangeInvalid && report.isLoading && <LoadingRows columns={7} />}
                        {!dateRangeInvalid && !report.isLoading && !report.isError && (reportData?.items.length ?? 0) === 0 && <TableRow><TableCell colSpan={7} className="py-14 text-center"><p className="font-semibold">No report rows for this selection</p><p className="mt-1 text-sm text-muted-foreground">Try another first-sent cohort range or clear a filter.</p></TableCell></TableRow>}
                        {reportData?.items.map((row) => (
                          <TableRow key={row.brokerId}>
                            <TableCell className="font-medium">{row.brokerName}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.totalSent.toLocaleString()}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.confirmedCount.toLocaleString()}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.disputedCount.toLocaleString()}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.noResponseCount.toLocaleString()}</TableCell>
                            <TableCell>{duration(row.averageResponseSeconds)}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{Number.isFinite(row.confirmationRate) ? `${row.confirmationRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm">
                    <span className="text-muted-foreground">{dateRangeInvalid ? "Correct the date range to see matching brokers." : `${(reportData?.total ?? 0).toLocaleString()} brokers · Page ${filters.page ?? 1} of ${reportPageCount}`}</span>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={dateRangeInvalid || (filters.page ?? 1) <= 1 || report.isFetching} onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, (current.page ?? 1) - 1) }))}>Previous</Button>
                      <Button type="button" variant="outline" size="sm" disabled={dateRangeInvalid || (filters.page ?? 1) >= reportPageCount || report.isFetching} onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}>Next</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {activity.isFetching && <span className="sr-only" role="status">Refreshing broker activity results</span>}
          </div>
        </AdminPageShell>
      </div>
    </div>
  );
}
