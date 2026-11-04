import { forwardRef, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent as BaseSelectContent, SelectItem, SelectTrigger as BaseSelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { NeuBadge, NeuButton, NeuCard, NeuInput, NeuPageShell, NeuStatCard, NeuTable, NeuTableBody, NeuTableCell, NeuTableHead, NeuTableHeader, NeuTableRow } from "@/styles/neu/components";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { PageInsights } from "@/components/PageInsights";
import { Download, FileText, Layers3, Plus, PlusCircle, Receipt, X } from "lucide-react";

type Broker = { id: number; name: string; status?: string };
type Carrier = { id: number; name: string; status?: string };
type Item = { id: number; carrierId: number; carrierName: string; ticketNumber: string; loadNumber: string; rate: number | string; invoiceId?: number; invoiceNumber?: string; createdAt?: string };
type Batch = { id: number; brokerId: number; brokerName: string; reportDateStart: string; reportDateEnd: string; totalRate: number | string; invoiceCount: number; ticketNumbers: string[]; createdAt: string; createdByName: string; items?: Item[] };
type PreflightAlert = { code: string; severity: "block" | "ack" | "info"; title: string; message: string; link?: string | null; invoiceId?: number | string; invoiceNumber?: string; affectedItems?: string[] };
type BulkPayload = { brokerId: number; reportDateStart: string; reportDateEnd: string; items: Array<{ carrierId: number; ticketNumber: string; loadNumber: string; rate: number }>; acknowledgements?: Array<{ code: string; reason?: string }>; overrideNearDuplicate?: boolean };

const rowSchema = z.object({
  carrierId: z.string().min(1, "Carrier required"),
  ticketNumber: z.string().trim().min(1, "Ticket required"),
  loadNumber: z.string().trim().min(1, "Load required"),
  rate: z.coerce.number().positive("Rate required").multipleOf(0.01, "Use no more than two decimal places"),
});
const formSchema = z.object({
  brokerId: z.string().min(1, "Broker required"),
  reportDateStart: z.string().min(1, "Start date required"),
  reportDateEnd: z.string().min(1, "End date required"),
  items: z.array(rowSchema).min(1, "Add at least one haul ticket"),
}).refine((value) => !value.reportDateStart || !value.reportDateEnd || value.reportDateStart <= value.reportDateEnd, {
  message: "End date must be on or after the start date",
  path: ["reportDateEnd"],
});
type FormValues = z.infer<typeof formSchema>;

const money = (value: unknown) => `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value?: string) => value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const shortDate = (value?: string) => value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

function FieldLabel({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-[#666666]">{children}{required && <span className="ml-1 text-[#1596a2]">*</span>}</label>;
}

function LoadingRows() {
  return <div className="space-y-3 p-5" aria-label="Loading batches">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded-[12px] bg-[#d5d5d5] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#ffffff]" />)}</div>;
}

function SelectContent(props: React.ComponentPropsWithoutRef<typeof BaseSelectContent>) {
  return <BaseSelectContent {...props} className={cn(props.className, "!pointer-events-auto [&&]:!rounded-[12px] !border-0 !bg-[#e0e0e0] !shadow-[-7px_-7px_16px_#ffffff,7px_7px_16px_#b8b8b8]")} />;
}

const SelectTrigger = forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof BaseSelectTrigger>>(
  (props, ref) => <BaseSelectTrigger {...props} ref={ref} className={cn(
    props.className,
    "[&&]:!rounded-[12px] [&&]:!border-0 [&&]:!bg-[#e0e0e0]",
    "[&&]:!shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff]",
    "[&&]:focus:!shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff]",
  )} />,
);
SelectTrigger.displayName = "BulkInvoiceSelectTrigger";

export default function BulkInvoices() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Batch | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const [preflightAlerts, setPreflightAlerts] = useState<PreflightAlert[]>([]);
  const [acknowledgements, setAcknowledgements] = useState<Record<string, { acknowledged: boolean; reason: string }>>({});
  const [overrideNearDuplicate, setOverrideNearDuplicate] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<BulkPayload | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = DEFAULT_PAGE_SIZE;
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { brokerId: "", reportDateStart: "", reportDateEnd: "", items: [{ carrierId: "", ticketNumber: "", loadNumber: "", rate: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const watchedItems = form.watch("items");
  const runningTotal = watchedItems.reduce((sum, row) => sum + Number(row.rate || 0), 0);

  const { data: brokers = [], isLoading: brokersLoading } = useQuery<Broker[]>({ queryKey: ["/api/brokers", { all: true }] });
  const { data: carriers = [] } = useQuery<Carrier[]>({ queryKey: ["/api/clients", { all: true }] });
  const { data: batches = [], isLoading, isError, refetch } = useQuery<Batch[]>({ queryKey: ["/api/bulk-invoices"] });
  const detailQuery = useQuery<Batch>({ queryKey: ["/api/bulk-invoices", detail?.id], enabled: Boolean(detail?.id) });
  const activeDetail = detailQuery.data || detail;

  const createMutation = useMutation<Batch & { createdInvoices?: unknown[] }, Error, BulkPayload>({
    mutationFn: async (payload) => {
      const response = await apiRequest("POST", "/api/bulk-invoices", payload);
      return response.json();
    },
    onSuccess: (created: Batch & { createdInvoices?: unknown[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-invoices"] });
      setCreateOpen(false);
      form.reset({ brokerId: "", reportDateStart: "", reportDateEnd: "", items: [{ carrierId: "", ticketNumber: "", loadNumber: "", rate: 0 }] });
      toast({ title: "Bulk invoice batch created", description: `${created?.invoiceCount || watchedItems.length} invoices are ready for review.` });
      if (created?.id) setDetail(created);
    },
    onError: (error) => {
      let body: any;
      try { body = JSON.parse(error.message); } catch { body = null; }
      if (body && Array.isArray(body.alerts)) {
        const affectedItems = (pendingPayload?.items || []).map((item, index) => `Row ${index + 1} · Ticket ${item.ticketNumber || "—"} · Load ${item.loadNumber || "—"}`);
        const alerts = mergeAlerts(body.alerts.map((alert: PreflightAlert) => ({
          ...alert,
          affectedItems: alert.affectedItems?.length ? alert.affectedItems : affectedItems,
        })));
        setPreflightAlerts(alerts);
        setPreflightError("The server found alerts that must be reviewed. Update your acknowledgements and try again.");
        setAcknowledgements((current) => {
          const next: typeof current = {};
          alerts.filter((alert) => alert.severity === "ack").forEach((alert) => { next[alert.code] = current[alert.code] ?? { acknowledged: false, reason: "" }; });
          return next;
        });
        setOverrideNearDuplicate(false);
        setPreflightOpen(true);
        return;
      }
      toast({ title: "Could not create batch", description: error.message || "Check the ticket details and try again.", variant: "destructive" });
    },
  });

  const brokerMap = useMemo(() => new Map(brokers.map((broker) => [broker.id, broker.name])), [brokers]);
  const sortedBatches = useMemo(() => [...batches].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [batches]);
  const pageCount = Math.max(1, Math.ceil(sortedBatches.length / pageSize));
  const visibleBatches = sortedBatches.slice((page - 1) * pageSize, page * pageSize);

  const openCreate = () => {
    form.reset({ brokerId: "", reportDateStart: "", reportDateEnd: "", items: [{ carrierId: "", ticketNumber: "", loadNumber: "", rate: 0 }] });
    setCreateOpen(true);
  };
  const downloadPdf = (id: number) => window.open(`/api/bulk-invoices/${id}/pdf`, "_blank", "noopener,noreferrer");
  const makePayload = (values: FormValues): BulkPayload => ({
    brokerId: Number(values.brokerId),
    reportDateStart: values.reportDateStart,
    reportDateEnd: values.reportDateEnd,
    items: values.items.map((item) => ({ carrierId: Number(item.carrierId), ticketNumber: item.ticketNumber.trim(), loadNumber: item.loadNumber.trim(), rate: Number(item.rate) })),
  });
  const mergeAlerts = (alerts: PreflightAlert[]) => {
    const grouped = new Map<string, PreflightAlert>();
    alerts.forEach((alert, index) => {
      const code = alert.code || `ALERT_${index + 1}`;
      const existing = grouped.get(code);
      const incomingAffected = alert.affectedItems || [];
      if (existing) {
        existing.affectedItems = Array.from(new Set([...(existing.affectedItems || []), ...incomingAffected]));
        if (existing.severity !== "block" && alert.severity === "block") existing.severity = "block";
      } else {
        grouped.set(code, { ...alert, code, affectedItems: Array.from(new Set(incomingAffected)) });
      }
    });
    return Array.from(grouped.values());
  };
  const runPreflight = async (values: FormValues) => {
    const payload = makePayload(values);
    setPendingPayload(payload);
    setPreflightLoading(true);
    setPreflightError("");
    setPreflightAlerts([]);
    setOverrideNearDuplicate(false);
    try {
      const results = await Promise.all(payload.items.map(async (item, index) => {
        const response = await fetch("/api/invoices/preflight", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            carrierId: item.carrierId,
            brokerId: payload.brokerId,
            loadNumber: item.loadNumber,
            amount: item.rate,
            serviceDate: payload.reportDateStart,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || `Preflight check failed for row ${index + 1} (${response.status}).`);
        const identifier = `Row ${index + 1} · Ticket ${item.ticketNumber || "—"} · Load ${item.loadNumber || "—"}`;
        return (Array.isArray(result.alerts) ? result.alerts : []).map((alert: PreflightAlert) => ({
          ...alert,
          affectedItems: [identifier],
        }));
      }));
      const alerts = mergeAlerts(results.flat());
      setPreflightAlerts(alerts);
      const nextAcknowledgements: typeof acknowledgements = {};
      alerts.filter((alert) => alert.severity === "ack").forEach((alert) => { nextAcknowledgements[alert.code] = { acknowledged: false, reason: "" }; });
      setAcknowledgements(nextAcknowledgements);
      if (alerts.length) setPreflightOpen(true);
      else createMutation.mutate({ ...payload, acknowledgements: [], overrideNearDuplicate: false });
    } catch (error) {
      setPreflightError(error instanceof Error ? error.message : "Unable to check invoice alerts.");
      setPreflightOpen(true);
    } finally {
      setPreflightLoading(false);
    }
  };
  const submit = (values: FormValues) => { void runPreflight(values); };
  const nearDuplicateAlert = preflightAlerts.some((alert) => alert.code === "DUPLICATE_NEAR" && alert.severity === "block");
  const unresolvedBlock = preflightAlerts.some((alert) => alert.severity === "block" && !(alert.code === "DUPLICATE_NEAR" && isManager && overrideNearDuplicate));
  const unacknowledged = preflightAlerts.some((alert) => alert.severity === "ack" && !acknowledgements[alert.code]?.acknowledged);
  const continueAfterPreflight = () => {
    if (!pendingPayload || unresolvedBlock || unacknowledged || (preflightError && !preflightAlerts.length)) return;
    createMutation.mutate({
      ...pendingPayload,
      acknowledgements: Object.entries(acknowledgements)
        .filter(([, value]) => value.acknowledged)
        .map(([code, value]) => ({ code, reason: value.reason.trim() || undefined })),
      overrideNearDuplicate: isManager && overrideNearDuplicate,
    });
    setPreflightOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 bg-[#e0e0e0] text-[#333333]">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopNav title="Bulk invoices" subtitle="High-volume haul ticket entry" group="Operations" neu />
        <NeuPageShell className="custom-scrollbar min-h-0 flex-1 overflow-auto">
          <PageInsights entity="bulk-invoices" title="Bulk invoice activity" />
          <div className="mx-auto max-w-[1580px] space-y-5 p-4 md:p-7">
            <NeuCard className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] px-5 py-4">
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#e0e0e0] text-[#27aab8] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]"><Layers3 className="h-5 w-5" /></div>
                <div><h2 className="text-xl font-bold tracking-tight text-[#333333]">Bulk invoice batches</h2><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[#777777]">Broker ledger · {batches.length} batches on file</p></div>
              </div>
              <NeuButton variant="accent" onClick={openCreate} className="min-h-10 rounded-[12px] px-4 text-xs"><Plus className="h-4 w-4" />New Bulk Invoice</NeuButton>
            </NeuCard>

            <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              {[
                ["Batches", batches.length],
                ["Tickets entered", batches.reduce((s, b) => s + Number(b.invoiceCount || 0), 0)],
                ["Ledger value", money(batches.reduce((s, b) => s + Number(b.totalRate || 0), 0))],
                ["Latest batch", batches[0] ? date(batches[0].createdAt) : "—"],
              ].map(([label, value]) => <NeuStatCard key={String(label)} label={String(label)} value={value} className="min-h-[120px] rounded-[16px] p-4 [&>div:last-child>p:first-child]:text-[#27aab8] [&>div:last-child>p:first-child]:text-2xl" />)}
            </section>

            <NeuCard className="overflow-hidden rounded-[16px] p-3 sm:p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3 px-1">
                <div><h3 className="text-base font-bold text-[#333333]">Recent batches</h3><p className="mt-1 text-xs text-[#777777]">Select a batch to inspect its tickets or download the invoice packet.</p></div>
                <span className="font-mono text-[11px] text-[#777777]">{sortedBatches.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, sortedBatches.length)} / ${sortedBatches.length}` : "0 / 0"}</span>
              </div>
              {isLoading ? <LoadingRows /> : isError ? <div className="p-10 text-center"><p className="text-sm font-bold text-[#9c4343]">Batch ledger unavailable</p><NeuButton onClick={() => refetch()} className="mt-4 min-h-9 rounded-[12px] px-4 text-xs">Retry</NeuButton></div> : !visibleBatches.length ? <div className="p-12 text-center"><Receipt className="mx-auto mb-3 h-8 w-8 text-[#1696a3]" /><p className="text-sm font-bold text-[#444444]">No bulk batches yet</p><p className="mt-1 text-xs text-[#777777]">Start with the first broker haul report.</p><NeuButton variant="accent" onClick={openCreate} className="mt-5 min-h-9 rounded-[12px] px-4 text-xs">Create a batch</NeuButton></div> : (
                <NeuTable className="min-w-[820px]">
                  <NeuTableHeader><tr><NeuTableHead>Broker</NeuTableHead><NeuTableHead>Ticket numbers</NeuTableHead><NeuTableHead>By agent</NeuTableHead><NeuTableHead>Date</NeuTableHead><NeuTableHead className="text-right">Tickets</NeuTableHead><NeuTableHead className="text-right">Total rate</NeuTableHead><NeuTableHead className="text-right">PDF</NeuTableHead></tr></NeuTableHeader>
                  <NeuTableBody>{visibleBatches.map((batch) => <NeuTableRow key={batch.id} onClick={() => setDetail(batch)} className="cursor-pointer">
                    <NeuTableCell><div className="font-bold text-[#444444]">{batch.brokerName || brokerMap.get(batch.brokerId) || "Unknown broker"}</div><div className="mt-1 font-mono text-[10px] text-[#888888]">BATCH-{String(batch.id).padStart(5, "0")}</div></NeuTableCell>
                    <NeuTableCell className="max-w-[290px] truncate font-mono text-[11px] text-[#666666]">{(batch.ticketNumbers || []).join(", ") || "No ticket numbers"}</NeuTableCell>
                    <NeuTableCell>{batch.createdByName || "Agent"}</NeuTableCell><NeuTableCell className="text-[#666666]">{shortDate(batch.reportDateStart)}–{shortDate(batch.reportDateEnd)}</NeuTableCell>
                    <NeuTableCell className="text-right font-mono">{batch.invoiceCount}</NeuTableCell><NeuTableCell className="text-right font-mono font-bold text-[#25806b]">{money(batch.totalRate)}</NeuTableCell>
                    <NeuTableCell className="text-right"><NeuButton title="Download PDF" aria-label="Download batch PDF" onClick={(event) => { event.stopPropagation(); downloadPdf(batch.id); }} className="min-h-9 w-9 rounded-[12px] p-0 text-[#1696a3]"><FileText className="h-4 w-4" /></NeuButton></NeuTableCell>
                  </NeuTableRow>)}</NeuTableBody>
                </NeuTable>
              )}
              {pageCount > 1 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#c9c9c9] pt-4"><p className="text-xs text-[#777777]">Page {page} of {pageCount}</p><div className="flex gap-2"><NeuButton disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="min-h-9 rounded-[12px] px-3 text-xs">Previous</NeuButton>{Array.from({ length: pageCount }, (_, i) => i + 1).slice(Math.max(0, page - 2), page + 1).map((number) => <NeuButton key={number} variant={number === page ? "accent" : "default"} onClick={() => setPage(number)} className="min-h-9 min-w-9 rounded-[12px] px-3 text-xs">{number}</NeuButton>)}<NeuButton disabled={page === pageCount} onClick={() => setPage((p) => p + 1)} className="min-h-9 rounded-[12px] px-3 text-xs">Next</NeuButton></div></div>}
            </NeuCard>
          </div>
        </NeuPageShell>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent showCloseButton={false} className="max-h-[92dvh] max-w-5xl grid-cols-1 overflow-y-auto !rounded-[16px] !border-0 !bg-[#e0e0e0] p-0 text-[#333333] !shadow-[-10px_-10px_24px_#ffffff,10px_10px_24px_#b8b8b8] [&>*]:min-w-0">
          <DialogHeader className="sticky top-0 z-10 flex-row items-start justify-between gap-3 rounded-t-[16px] bg-[#e0e0e0] px-5 py-4 shadow-[0_5px_10px_-9px_#777777] sm:px-7">
            <div><DialogTitle className="text-lg font-bold">New Bulk Invoice · ticket entry</DialogTitle><DialogDescription className="mt-1 text-xs text-[#777777]">Enter a broker report and its individual carrier haul tickets.</DialogDescription></div>
            <DialogClose asChild><NeuButton aria-label="Close bulk invoice form" className="min-h-9 h-9 w-9 shrink-0 rounded-full p-0"><X className="h-4 w-4" /></NeuButton></DialogClose>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-5 px-5 pb-6 sm:px-7">
            <NeuCard className="grid gap-4 rounded-[16px] p-4 md:grid-cols-[1.5fr_1fr_1fr]">
              <div><FieldLabel required>Broker</FieldLabel><Select value={form.watch("brokerId")} onValueChange={(v) => form.setValue("brokerId", v, { shouldValidate: true })}><SelectTrigger className="h-10 rounded-[12px] border-0 bg-[#e0e0e0] text-sm text-[#333333] shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff] transition-shadow focus-visible:ring-2 focus-visible:ring-[#27aab8]"><SelectValue placeholder={brokersLoading ? "Loading brokers…" : "Select broker"} /></SelectTrigger><SelectContent className="rounded-[12px] border-0 bg-[#e0e0e0] text-[#333333] shadow-[-7px_-7px_16px_#ffffff,7px_7px_16px_#b8b8b8]">{brokers.map((broker) => <SelectItem key={broker.id} value={String(broker.id)} className="rounded-[8px] focus:bg-[#d4eeee] focus:text-[#245e63]">{broker.name}</SelectItem>)}</SelectContent></Select>{form.formState.errors.brokerId && <p className="mt-1 text-[10px] text-[#a34141]">{form.formState.errors.brokerId.message}</p>}</div>
              <div><FieldLabel required>Report date start</FieldLabel><NeuInput type="date" className="h-10 min-h-10 rounded-[12px] px-3 text-xs" {...form.register("reportDateStart")} />{form.formState.errors.reportDateStart && <p className="mt-1 text-[10px] text-[#a34141]">{form.formState.errors.reportDateStart.message}</p>}</div>
              <div><FieldLabel required>Report date end</FieldLabel><NeuInput type="date" className="h-10 min-h-10 rounded-[12px] px-3 text-xs" {...form.register("reportDateEnd")} />{form.formState.errors.reportDateEnd && <p className="mt-1 text-[10px] text-[#a34141]">{form.formState.errors.reportDateEnd.message}</p>}</div>
            </NeuCard>
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-sm font-bold text-[#444444]">Haul tickets</h3><p className="mt-1 text-xs text-[#777777]">One row becomes one carrier invoice.</p></div><NeuButton type="button" onClick={() => append({ carrierId: "", ticketNumber: "", loadNumber: "", rate: 0 })} className="min-h-9 rounded-[12px] px-4 text-xs"><PlusCircle className="h-4 w-4" />Add row</NeuButton></div>
            <div className="overflow-x-auto rounded-[16px] bg-[#e0e0e0] p-2 shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff]">
              <div className="min-w-[700px]">
                <div className="grid grid-cols-[1.4fr_1fr_1fr_130px_40px] gap-2 px-2 pb-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[#777777]"><span>Carrier</span><span>Ticket #</span><span>Load #</span><span>Rate $</span><span /></div>
                {fields.map((field, index) => <div key={field.id} className="grid grid-cols-[1.4fr_1fr_1fr_130px_40px] items-start gap-2 border-t border-[#c9c9c9] px-2 py-3">
                  <div><Select value={form.watch(`items.${index}.carrierId`)} onValueChange={(v) => form.setValue(`items.${index}.carrierId`, v, { shouldValidate: true })}><SelectTrigger className="h-9 rounded-[12px] border-0 bg-[#e0e0e0] text-[11px] text-[#333333] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff] focus-visible:ring-2 focus-visible:ring-[#27aab8]"><SelectValue placeholder="Select carrier" /></SelectTrigger><SelectContent className="rounded-[12px] border-0 bg-[#e0e0e0] text-[#333333] shadow-[-7px_-7px_16px_#ffffff,7px_7px_16px_#b8b8b8]">{carriers.map((carrier) => <SelectItem key={carrier.id} value={String(carrier.id)} className="rounded-[8px] focus:bg-[#d4eeee] focus:text-[#245e63]">{carrier.name}</SelectItem>)}</SelectContent></Select>{form.formState.errors.items?.[index]?.carrierId && <p className="mt-1 text-[10px] text-[#a34141]">Required</p>}</div>
                  <div><NeuInput className="h-9 min-h-9 rounded-[12px] px-3 font-mono text-[11px]" placeholder="TK-10482" {...form.register(`items.${index}.ticketNumber`)} />{form.formState.errors.items?.[index]?.ticketNumber && <p className="mt-1 text-[10px] text-[#a34141]">Required</p>}</div>
                  <div><NeuInput className="h-9 min-h-9 rounded-[12px] px-3 font-mono text-[11px]" placeholder="LD-8841" {...form.register(`items.${index}.loadNumber`)} /></div>
                  <div><NeuInput type="number" step="0.01" min="0" className="h-9 min-h-9 rounded-[12px] px-3 text-right font-mono text-[11px]" placeholder="0.00" {...form.register(`items.${index}.rate`, { valueAsNumber: true })} />{form.formState.errors.items?.[index]?.rate && <p className="mt-1 text-[10px] text-[#a34141]">Required</p>}</div>
                  <NeuButton type="button" disabled={fields.length === 1} onClick={() => remove(index)} title="Remove row" aria-label="Remove ticket row" className="min-h-9 h-9 w-9 rounded-[12px] p-0 text-[#a34141]"><X className="h-4 w-4" /></NeuButton>
                </div>)}
              </div>
            </div>
            {form.formState.errors.items?.root && <p className="text-xs text-[#a34141]">{form.formState.errors.items.root.message}</p>}
            <NeuCard pressed className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] px-4 py-3"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#666666]">{fields.length} ticket{fields.length === 1 ? "" : "s"} queued</span><span className="font-mono text-sm font-bold text-[#168b91]">Running total {money(runningTotal)}</span></NeuCard>
            <div className="flex justify-end gap-2"><NeuButton type="button" onClick={() => setCreateOpen(false)} className="min-h-10 rounded-[12px] px-4">Cancel</NeuButton><NeuButton type="submit" variant="accent" disabled={createMutation.isPending || preflightLoading} className="min-h-10 rounded-[12px] px-4"><Receipt className="h-4 w-4" />{preflightLoading ? "Checking alerts…" : createMutation.isPending ? "Creating invoices…" : "Create batch & invoices"}</NeuButton></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <DialogContent showCloseButton={false} className="max-h-[84dvh] max-w-2xl grid-cols-1 overflow-y-auto !rounded-[16px] !border-0 !bg-[#e0e0e0] p-5 text-[#333333] !shadow-[-10px_-10px_24px_#ffffff,10px_10px_24px_#b8b8b8] sm:p-6 [&>*]:min-w-0">
          <DialogHeader className="flex-row items-start justify-between gap-3">
            <div><DialogTitle className="text-lg font-bold">Bulk Invoice Preflight</DialogTitle><DialogDescription className="mt-1 text-xs text-[#777777]">Review carrier and broker checks for each ticket before creating the batch.</DialogDescription></div>
            <DialogClose asChild><NeuButton aria-label="Close preflight alerts" className="min-h-9 h-9 w-9 shrink-0 rounded-full p-0"><X className="h-4 w-4" /></NeuButton></DialogClose>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {preflightLoading && <NeuCard pressed className="rounded-[12px] px-4 py-3 text-xs text-[#666666]">Checking all ticket rows…</NeuCard>}
            {preflightError && <NeuCard role="alert" className="rounded-[12px] border border-[#d6b1ab] bg-[#f4e5e2] px-4 py-3 text-sm text-[#843f39]">{preflightError}</NeuCard>}
            {preflightAlerts.map((alert, index) => {
              const tone = alert.severity === "block" ? "warning" : alert.severity === "ack" ? "accent" : "neutral";
              const blockStyle = alert.severity === "block" ? "bg-[#f1e4e1]" : alert.severity === "ack" ? "bg-[#e3f0f0]" : "bg-[#e7e9e7]";
              return <NeuCard key={`${alert.code}-${index}`} className={cn("rounded-[14px] p-4", blockStyle)}>
                <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{alert.title || alert.code}</strong><NeuBadge tone={tone}>{alert.severity === "block" ? "Block" : alert.severity === "ack" ? "Acknowledgement required" : "Information"}</NeuBadge></div>
                <p className="mt-2 text-sm leading-relaxed text-[#555555]">{alert.message}</p>
                {(alert.link || alert.invoiceId) && <a className="mt-2 inline-block text-xs font-bold text-[#168b91] underline underline-offset-2" href={alert.link || `/invoices/${alert.invoiceId}`} target={alert.link?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{alert.invoiceNumber ? `View invoice ${alert.invoiceNumber}` : "View matching invoice"}</a>}
                {!!alert.affectedItems?.length && <div className="mt-3 border-t border-[#888888]/25 pt-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[#666666]">Affected tickets</p><ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-[#555555]">{alert.affectedItems.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                {alert.severity === "ack" && <div className="mt-3 border-t border-[#888888]/25 pt-3">
                  <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-[#444444]"><input type="checkbox" className="mt-0.5 accent-[#27aab8]" checked={!!acknowledgements[alert.code]?.acknowledged} onChange={(event) => setAcknowledgements((current) => ({ ...current, [alert.code]: { acknowledged: event.target.checked, reason: current[alert.code]?.reason ?? "" } }))} />I have reviewed and acknowledge this alert</label>
                  <label className="mt-3 block text-xs font-semibold text-[#666666]">Reason (optional)<textarea value={acknowledgements[alert.code]?.reason ?? ""} onChange={(event) => setAcknowledgements((current) => ({ ...current, [alert.code]: { acknowledged: !!current[alert.code]?.acknowledged, reason: event.target.value } }))} className="mt-1.5 min-h-20 w-full rounded-[12px] border-0 bg-[#e0e0e0] p-3 text-sm font-normal text-[#333333] shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#27aab8]" /></label>
                </div>}
              </NeuCard>;
            })}
            {nearDuplicateAlert && isManager && <NeuCard className="rounded-[14px] bg-[#f4eadb] p-4 text-[#73501e]"><label className="flex cursor-pointer items-start gap-2"><input type="checkbox" className="mt-1 accent-[#27aab8]" checked={overrideNearDuplicate} onChange={(event) => setOverrideNearDuplicate(event.target.checked)} /><span className="text-sm"><strong>Manager override:</strong> allow creation despite the near-duplicate alert.</span></label></NeuCard>}
            {preflightAlerts.length === 0 && !preflightLoading && !preflightError && <NeuCard pressed className="rounded-[12px] px-4 py-3 text-xs text-[#666666]">No active preflight alerts.</NeuCard>}
            <div className="flex flex-wrap justify-end gap-2 border-t border-[#c9c9c9] pt-4">
              <NeuButton type="button" onClick={() => setPreflightOpen(false)} className="min-h-10 rounded-[12px] px-4">Close</NeuButton>
              <NeuButton type="button" variant="accent" disabled={preflightLoading || createMutation.isPending || !pendingPayload || unresolvedBlock || unacknowledged || Boolean(preflightError && !preflightAlerts.length)} onClick={continueAfterPreflight} className="min-h-10 rounded-[12px] px-4">{createMutation.isPending ? "Creating…" : "Acknowledge & create batch"}</NeuButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent showCloseButton={false} className="max-h-[90dvh] max-w-4xl grid-cols-1 overflow-y-auto !rounded-[16px] !border-0 !bg-[#e0e0e0] p-0 text-[#333333] !shadow-[-10px_-10px_24px_#ffffff,10px_10px_24px_#b8b8b8] [&>*]:min-w-0">
          <DialogHeader className="flex-row items-start justify-between gap-3 rounded-t-[16px] px-5 py-4 shadow-[0_5px_10px_-9px_#777777] sm:px-6">
            <div><DialogTitle className="text-lg font-bold">{activeDetail?.brokerName || "Bulk invoice batch"}</DialogTitle><DialogDescription className="mt-1 text-xs text-[#777777]">BATCH-{String(activeDetail?.id || detail?.id || 0).padStart(5, "0")} · Report {shortDate(activeDetail?.reportDateStart)}–{shortDate(activeDetail?.reportDateEnd)} · created by {activeDetail?.createdByName || "Agent"}</DialogDescription></div>
            <div className="flex shrink-0 items-center gap-2"><NeuButton onClick={() => activeDetail && downloadPdf(activeDetail.id)} className="min-h-9 rounded-[12px] px-3 text-xs"><Download className="h-4 w-4" /><span className="hidden sm:inline">Download PDF</span></NeuButton><DialogClose asChild><NeuButton aria-label="Close batch details" className="min-h-9 h-9 w-9 rounded-full p-0"><X className="h-4 w-4" /></NeuButton></DialogClose></div>
          </DialogHeader>
          <div className="space-y-4 px-5 pb-6 sm:px-6">{detailQuery.isLoading ? <LoadingRows /> : <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Tickets", activeDetail?.invoiceCount || 0], ["Total rate", money(activeDetail?.totalRate)], ["Report start", date(activeDetail?.reportDateStart)], ["Created", date(activeDetail?.createdAt)]].map(([label, value]) => <NeuCard key={String(label)} className="rounded-[14px] p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-[#1696a3]">{label}</p><p className="mt-2 text-sm font-bold text-[#444444]">{value}</p></NeuCard>)}</div>
            <NeuTable className="min-w-[650px]"><NeuTableHeader><tr><NeuTableHead>Carrier</NeuTableHead><NeuTableHead>Ticket #</NeuTableHead><NeuTableHead>Load #</NeuTableHead><NeuTableHead className="text-right">Rate</NeuTableHead><NeuTableHead>Invoice #</NeuTableHead></tr></NeuTableHeader><NeuTableBody>{(activeDetail?.items || []).map((item) => <NeuTableRow key={item.id}><NeuTableCell>{item.carrierName}</NeuTableCell><NeuTableCell className="font-mono">{item.ticketNumber}</NeuTableCell><NeuTableCell className="font-mono">{item.loadNumber}</NeuTableCell><NeuTableCell className="text-right font-mono font-bold">{money(item.rate)}</NeuTableCell><NeuTableCell className="font-mono text-[#666666]">{item.invoiceNumber || "Created"}</NeuTableCell></NeuTableRow>)}</NeuTableBody></NeuTable>
            {!activeDetail?.items?.length && <p className="rounded-[12px] p-8 text-center text-xs text-[#777777]">Ticket detail is not available for this batch.</p>}
          </>}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}