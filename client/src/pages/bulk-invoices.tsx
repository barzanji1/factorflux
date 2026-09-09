import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Download, FileText, Layers3, Plus, PlusCircle, Receipt, X } from "lucide-react";

type Broker = { id: number; name: string; status?: string };
type Carrier = { id: number; name: string; status?: string };
type Item = { id: number; carrierId: number; carrierName: string; ticketNumber: string; loadNumber: string; rate: number | string; invoiceId?: number; invoiceNumber?: string; createdAt?: string };
type Batch = { id: number; brokerId: number; brokerName: string; reportDateStart: string; reportDateEnd: string; totalRate: number | string; invoiceCount: number; ticketNumbers: string[]; createdAt: string; createdByName: string; items?: Item[] };

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
  return <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-[#63767d]">{children}{required && <span className="ml-1 text-[#b14c38]">*</span>}</label>;
}

function LoadingRows() {
  return <div className="space-y-2 p-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-11 animate-pulse bg-[#eef2f1]" />)}</div>;
}

export default function BulkInvoices() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Batch | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 12;
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

  const createMutation = useMutation<Batch & { createdInvoices?: unknown[] }, Error, any>({
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
    onError: () => toast({ title: "Could not create batch", description: "Check the ticket details and try again.", variant: "destructive" }),
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
  const submit = (values: FormValues) => createMutation.mutate({
    brokerId: Number(values.brokerId),
    reportDateStart: values.reportDateStart,
    reportDateEnd: values.reportDateEnd,
    items: values.items.map((item) => ({ carrierId: Number(item.carrierId), ticketNumber: item.ticketNumber.trim(), loadNumber: item.loadNumber.trim(), rate: Number(item.rate) })),
  });

  return (
    <div className="flex min-h-[100dvh] bg-[#d4d0c8] text-[#263b44]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav title="Bulk invoices" subtitle="High-volume haul ticket entry" group="Operations" />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto max-w-[1580px] space-y-3 p-3 md:p-5">
            <section className="flex flex-wrap items-center justify-between gap-3 border border-[#718087] bg-[#edf2f1] px-3 py-2 shadow-[1px_1px_0_#fff]">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center border border-[#098b9f] bg-[#d9edf0] text-[#087d8d]"><Layers3 className="h-5 w-5" /></div>
                <div><h2 className="text-lg font-bold tracking-tight text-[#203a46]">Bulk invoice batches</h2><p className="text-[10px] uppercase tracking-[0.14em] text-[#667a80]">Broker ledger · {batches.length} batches on file</p></div>
              </div>
              <Button onClick={openCreate} className="h-9 gap-2 rounded-sm bg-[#087d8d] px-3 text-[11px] text-white hover:bg-[#066b79]"><Plus className="h-4 w-4" />New Bulk Invoice</Button>
            </section>

            <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[["Batches", batches.length, "text-[#087d8d]"], ["Tickets entered", batches.reduce((s, b) => s + Number(b.invoiceCount || 0), 0), "text-[#42616c]"], ["Ledger value", money(batches.reduce((s, b) => s + Number(b.totalRate || 0), 0)), "text-[#167152]"], ["Latest batch", batches[0] ? date(batches[0].createdAt) : "—", "text-[#946316]"]].map(([label, value, color]) => <div key={String(label)} className="border border-[#9eabad] bg-[#eef3f1] px-3 py-2 shadow-[1px_1px_0_#fff]"><p className="text-[9px] font-bold uppercase tracking-wider text-[#718187]">{label}</p><p className={cn("mt-1 text-base font-bold", color)}>{value}</p></div>)}
            </section>

            <section className="border-2 border-[#fff] border-r-[#808080] border-b-[#808080] bg-white">
              <div className="flex items-center justify-between border-b border-[#b8c2c4] bg-[#f0f4f3] px-3 py-2"><div><h3 className="text-[12px] font-bold text-[#263b44]">Recent batches</h3><p className="text-[10px] text-[#718187]">Select a batch to inspect its tickets or download the invoice packet.</p></div><span className="font-mono text-[10px] text-[#718187]">{sortedBatches.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, sortedBatches.length)} / ${sortedBatches.length}` : "0 / 0"}</span></div>
              {isLoading ? <LoadingRows /> : isError ? <div className="p-10 text-center"><p className="text-sm font-bold text-[#9c4343]">Batch ledger unavailable</p><Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3 rounded-sm">Retry</Button></div> : !visibleBatches.length ? <div className="p-12 text-center"><Receipt className="mx-auto mb-2 h-8 w-8 text-[#9aa7ab]" /><p className="text-sm font-bold text-[#52666d]">No bulk batches yet</p><p className="mt-1 text-xs text-[#718187]">Start with the first broker haul report.</p><Button onClick={openCreate} size="sm" className="mt-4 rounded-sm bg-[#087d8d]">Create a batch</Button></div> : <div className="overflow-x-auto"><table className="ff-data-table min-w-[820px]"><thead><tr><th>Broker</th><th>Ticket numbers</th><th>By agent</th><th>Date</th><th className="text-right">Tickets</th><th className="text-right">Total rate</th><th className="text-right">PDF</th></tr></thead><tbody>{visibleBatches.map((batch) => <tr key={batch.id} onClick={() => setDetail(batch)} className="cursor-pointer"><td><div className="font-bold text-[#263b44]">{batch.brokerName || brokerMap.get(batch.brokerId) || "Unknown broker"}</div><div className="font-mono text-[10px] text-[#9aa7ab]">BATCH-{String(batch.id).padStart(5, "0")}</div></td><td className="max-w-[290px] truncate font-mono text-[11px] text-[#52666d]">{(batch.ticketNumbers || []).join(", ") || "No ticket numbers"}</td><td className="whitespace-nowrap">{batch.createdByName || "Agent"}</td><td className="whitespace-nowrap text-[#63767d]">{shortDate(batch.reportDateStart)}–{shortDate(batch.reportDateEnd)}</td><td className="text-right font-mono">{batch.invoiceCount}</td><td className="text-right font-mono font-bold text-[#167152]">{money(batch.totalRate)}</td><td className="text-right"><Button variant="ghost" size="sm" title="Download PDF" aria-label="Download batch PDF" onClick={(event) => { event.stopPropagation(); downloadPdf(batch.id); }} className="h-7 w-7 rounded-sm p-0 text-[#087d8d] hover:bg-[#dff5f6]"><FileText className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>}
              {pageCount > 1 && <div className="flex items-center justify-between border-t border-[#d4dcde] bg-[#f7f9f8] px-3 py-2"><p className="text-[10px] text-[#718187]">Page {page} of {pageCount}</p><div className="flex gap-1"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="h-7 rounded-sm px-2 text-[10px]">Previous</Button>{Array.from({ length: pageCount }, (_, i) => i + 1).slice(Math.max(0, page - 2), page + 1).map((number) => <Button key={number} variant={number === page ? "default" : "outline"} size="sm" onClick={() => setPage(number)} className="h-7 min-w-7 rounded-sm px-2 text-[10px]">{number}</Button>)}<Button variant="outline" size="sm" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)} className="h-7 rounded-sm px-2 text-[10px]">Next</Button></div></div>}
            </section>
          </div>
        </main>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-sm border-2 border-[#808080] bg-[#d4d0c8] p-0">
          <DialogHeader className="border-b-2 border-[#808080] bg-[#c0c0c0] px-4 py-3 pr-12"><DialogTitle className="text-sm font-bold text-[#1a1a1a]">New Bulk Invoice · ticket entry</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4 p-4">
            <div className="grid gap-3 border-2 border-[#fff] border-r-[#808080] border-b-[#808080] bg-[#eef3f1] p-3 md:grid-cols-[1.5fr_1fr_1fr]">
              <div><FieldLabel required>Broker</FieldLabel><Select value={form.watch("brokerId")} onValueChange={(v) => form.setValue("brokerId", v, { shouldValidate: true })}><SelectTrigger className="h-9 rounded-sm bg-white"><SelectValue placeholder={brokersLoading ? "Loading brokers…" : "Select broker"} /></SelectTrigger><SelectContent>{brokers.map((broker) => <SelectItem key={broker.id} value={String(broker.id)}>{broker.name}</SelectItem>)}</SelectContent></Select>{form.formState.errors.brokerId && <p className="mt-1 text-[10px] text-[#a33131]">{form.formState.errors.brokerId.message}</p>}</div>
              <div><FieldLabel required>Report date start</FieldLabel><Input type="date" className="h-9 rounded-sm" {...form.register("reportDateStart")} />{form.formState.errors.reportDateStart && <p className="mt-1 text-[10px] text-[#a33131]">{form.formState.errors.reportDateStart.message}</p>}</div>
              <div><FieldLabel required>Report date end</FieldLabel><Input type="date" className="h-9 rounded-sm" {...form.register("reportDateEnd")} />{form.formState.errors.reportDateEnd && <p className="mt-1 text-[10px] text-[#a33131]">{form.formState.errors.reportDateEnd.message}</p>}</div>
            </div>
            <Separator />
            <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-[12px] font-bold text-[#263b44]">Haul tickets</h3><p className="text-[10px] text-[#718187]">One row becomes one carrier invoice.</p></div><Button type="button" variant="outline" size="sm" onClick={() => append({ carrierId: "", ticketNumber: "", loadNumber: "", rate: 0 })} className="h-8 gap-1 rounded-sm text-[10px]"><PlusCircle className="h-3.5 w-3.5" />Add row</Button></div>
            <div className="overflow-x-auto border border-[#9eabad] bg-white"><div className="min-w-[700px]"><div className="grid grid-cols-[1.4fr_1fr_1fr_130px_34px] gap-2 border-b border-[#b8c2c4] bg-[#f0f4f3] px-2 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[#63767d]"><span>Carrier</span><span>Ticket #</span><span>Load #</span><span>Rate $</span><span /></div>{fields.map((field, index) => <div key={field.id} className="grid grid-cols-[1.4fr_1fr_1fr_130px_34px] items-start gap-2 border-b border-[#e1e6e7] px-2 py-2 last:border-b-0"><div><Select value={form.watch(`items.${index}.carrierId`)} onValueChange={(v) => form.setValue(`items.${index}.carrierId`, v, { shouldValidate: true })}><SelectTrigger className="h-8 rounded-sm text-[11px]"><SelectValue placeholder="Select carrier" /></SelectTrigger><SelectContent>{carriers.map((carrier) => <SelectItem key={carrier.id} value={String(carrier.id)}>{carrier.name}</SelectItem>)}</SelectContent></Select>{form.formState.errors.items?.[index]?.carrierId && <p className="mt-1 text-[10px] text-[#a33131]">Required</p>}</div><div><Input className="h-8 rounded-sm font-mono text-[11px]" placeholder="TK-10482" {...form.register(`items.${index}.ticketNumber`)} />{form.formState.errors.items?.[index]?.ticketNumber && <p className="mt-1 text-[10px] text-[#a33131]">Required</p>}</div><div><Input className="h-8 rounded-sm font-mono text-[11px]" placeholder="LD-8841" {...form.register(`items.${index}.loadNumber`)} /></div><div><Input type="number" step="0.01" min="0" className="h-8 rounded-sm text-right font-mono text-[11px]" placeholder="0.00" {...form.register(`items.${index}.rate`, { valueAsNumber: true })} />{form.formState.errors.items?.[index]?.rate && <p className="mt-1 text-[10px] text-[#a33131]">Required</p>}</div><Button type="button" variant="ghost" size="sm" disabled={fields.length === 1} onClick={() => remove(index)} title="Remove row" aria-label="Remove ticket row" className="h-8 w-8 rounded-sm p-0 text-[#9c4343] hover:bg-[#fff0ed]"><X className="h-4 w-4" /></Button></div>)}</div></div>
            {form.formState.errors.items?.root && <p className="text-[10px] text-[#a33131]">{form.formState.errors.items.root.message}</p>}
            <div className="flex flex-wrap items-center justify-between border border-[#9eabad] bg-[#eef3f1] px-3 py-2"><span className="text-[10px] uppercase tracking-[0.12em] text-[#63767d]">{fields.length} ticket{fields.length === 1 ? "" : "s"} queued</span><span className="font-mono text-sm font-bold text-[#167152]">Running total {money(runningTotal)}</span></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)} className="rounded-sm">Cancel</Button><Button type="submit" disabled={createMutation.isPending} className="gap-2 rounded-sm bg-[#087d8d] text-white hover:bg-[#066b79]"><Receipt className="h-4 w-4" />{createMutation.isPending ? "Creating invoices…" : "Create batch & invoices"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto rounded-sm border-2 border-[#808080] bg-[#d4d0c8] p-0">
          <DialogHeader className="flex-row items-start justify-between border-b-2 border-[#808080] bg-[#c0c0c0] px-4 py-3 pr-12"><div><DialogTitle className="text-sm font-bold text-[#1a1a1a]">{activeDetail?.brokerName || "Bulk invoice batch"}</DialogTitle><p className="mt-1 text-[10px] text-[#444]">Report {shortDate(activeDetail?.reportDateStart)}–{shortDate(activeDetail?.reportDateEnd)} · created by {activeDetail?.createdByName || "Agent"}</p></div><Button variant="outline" size="sm" onClick={() => activeDetail && downloadPdf(activeDetail.id)} className="h-8 gap-1 rounded-sm text-[10px]"><Download className="h-3.5 w-3.5" />Download PDF</Button></DialogHeader>
          <div className="p-4">{detailQuery.isLoading ? <LoadingRows /> : <><div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">{[["Tickets", activeDetail?.invoiceCount || 0], ["Total rate", money(activeDetail?.totalRate)], ["Report start", date(activeDetail?.reportDateStart)], ["Created", date(activeDetail?.createdAt)]].map(([label, value]) => <div key={String(label)} className="border border-[#9eabad] bg-[#eef3f1] px-2 py-2"><p className="text-[9px] uppercase tracking-wider text-[#718187]">{label}</p><p className="mt-1 text-[12px] font-bold">{value}</p></div>)}</div><div className="overflow-x-auto border border-[#9eabad] bg-white"><table className="ff-data-table min-w-[650px]"><thead><tr><th>Carrier</th><th>Ticket #</th><th>Load #</th><th className="text-right">Rate</th><th>Invoice #</th></tr></thead><tbody>{(activeDetail?.items || []).map((item) => <tr key={item.id}><td>{item.carrierName}</td><td className="font-mono">{item.ticketNumber}</td><td className="font-mono">{item.loadNumber}</td><td className="text-right font-mono font-bold">{money(item.rate)}</td><td className="font-mono text-[#63767d]">{item.invoiceNumber || "Created"}</td></tr>)}</tbody></table>{!activeDetail?.items?.length && <p className="p-8 text-center text-xs text-[#718187]">Ticket detail is not available for this batch.</p>}</div></>}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}