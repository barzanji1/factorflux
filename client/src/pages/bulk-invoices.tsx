import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, MoreHorizontal, Layers, Trash2, PlusCircle, ChevronLeft, Send, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BulkInvoiceItem {
  id: number;
  batchId: number;
  invoiceNumber: string;
  loadNumber: string | null;
  amount: string;
  brokerName: string | null;
  status: "pending" | "approved" | "rejected";
  notes: string | null;
}

interface BulkInvoiceBatch {
  id: number;
  batchName: string;
  carrierId: number;
  totalAmount: string;
  invoiceCount: number;
  status: "draft" | "submitted" | "processing" | "completed" | "failed";
  submittedAt: string | null;
  createdAt: string;
  items?: BulkInvoiceItem[];
}

interface Client { id: number; name: string; }

// ─── Form schema ──────────────────────────────────────────────────────────────

const itemSchema = z.object({
  invoiceNumber: z.string().min(1, "Invoice # required"),
  loadNumber: z.string().optional(),
  amount: z.coerce.number().positive("Amount required"),
  brokerName: z.string().optional(),
  notes: z.string().optional(),
});

const batchSchema = z.object({
  batchName: z.string().min(1, "Batch name required"),
  carrierId: z.string().min(1, "Carrier required"),
  items: z.array(itemSchema).min(1, "Add at least one invoice"),
});

type BatchForm = z.infer<typeof batchSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const BATCH_STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  processing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const ITEM_STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] ?? ""}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BulkInvoices() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailBatch, setDetailBatch] = useState<BulkInvoiceBatch | null>(null);
  const [carrierFilter, setCarrierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const form = useForm<BatchForm>({
    resolver: zodResolver(batchSchema),
    defaultValues: { batchName: "", carrierId: "", items: [{ invoiceNumber: "", loadNumber: "", amount: 0, brokerName: "", notes: "" }] },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const watchItems = form.watch("items");
  const runningTotal = watchItems.reduce((s, i) => s + Number(i.amount || 0), 0);

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: batches = [], isLoading } = useQuery<BulkInvoiceBatch[]>({ queryKey: ["/api/bulk-invoices"] });
  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ["/api/clients"] });

  const { data: batchDetail, isLoading: detailLoading } = useQuery<BulkInvoiceBatch>({
    queryKey: ["/api/bulk-invoices", detailBatch?.id],
    enabled: !!detailBatch,
  });

  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c.name]));

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/bulk-invoices", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-invoices"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Batch created" });
    },
    onError: async (e: any) => {
      let msg = "Failed to create batch";
      try { const j = await e?.response?.json?.(); if (j?.message) msg = j.message; } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/bulk-invoices/${id}`, { status }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-invoices", vars.id] });
      if (detailBatch?.id === vars.id) {
        setDetailBatch((prev) => prev ? { ...prev, status: vars.status as any } : prev);
      }
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bulk-invoices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-invoices"] });
      toast({ title: "Batch deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function openCreate() {
    form.reset({
      batchName: `Batch-${new Date().toISOString().slice(0, 10)}`,
      carrierId: "",
      items: [{ invoiceNumber: "", loadNumber: "", amount: 0, brokerName: "", notes: "" }],
    });
    setDialogOpen(true);
  }

  function onSubmit(data: BatchForm) {
    createMutation.mutate({
      batchName: data.batchName,
      carrierId: data.carrierId,
      items: data.items.map((i) => ({
        ...i,
        amount: Number(i.amount),
      })),
    });
  }

  // ─── Filtering ─────────────────────────────────────────────────────────────

  const filtered = batches.filter((b) => {
    const matchCarrier = carrierFilter === "all" || String(b.carrierId) === carrierFilter;
    const matchStatus = statusFilter === "all" || b.status === statusFilter;
    return matchCarrier && matchStatus;
  });

  const activeDetail = batchDetail ?? detailBatch;

  // ─── Detail View ───────────────────────────────────────────────────────────

  if (detailBatch) {
    return (
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopNav />
          <main className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setDetailBatch(null)} className="gap-1">
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <Separator orientation="vertical" className="h-5" />
              <div className="flex items-center gap-2 flex-1">
                <h1 className="text-xl font-bold">{activeDetail?.batchName}</h1>
                {activeDetail && <StatusBadge status={activeDetail.status} map={BATCH_STATUS_STYLES} />}
              </div>
              {activeDetail?.status === "draft" && (
                <Button
                  className="gap-2"
                  onClick={() => statusMutation.mutate({ id: detailBatch.id, status: "submitted" })}
                  disabled={statusMutation.isPending}
                >
                  <Send className="h-4 w-4" /> Submit Batch
                </Button>
              )}
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "Carrier", value: clientMap[activeDetail?.carrierId ?? 0] ?? "—" },
                { label: "Invoice Count", value: String(activeDetail?.invoiceCount ?? 0) },
                { label: "Total Amount", value: fmt(activeDetail?.totalAmount ?? 0) },
                { label: "Submitted", value: fmtDate(activeDetail?.submittedAt ?? null) },
              ].map((s) => (
                <Card key={s.label}>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-lg font-semibold mt-1">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Items table */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Invoice Items</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Load #</TableHead>
                      <TableHead>Broker</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailLoading ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                    ) : !activeDetail?.items?.length ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No items in this batch.</TableCell></TableRow>
                    ) : activeDetail.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.invoiceNumber}</TableCell>
                        <TableCell className="text-muted-foreground">{item.loadNumber ?? "—"}</TableCell>
                        <TableCell>{item.brokerName ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{fmt(item.amount)}</TableCell>
                        <TableCell><StatusBadge status={item.status} map={ITEM_STATUS_STYLES} /></TableCell>
                        <TableCell className="text-muted-foreground text-sm">{item.notes ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>
    );
  }

  // ─── List View ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopNav />
        <main className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Bulk Invoices</h1>
                <p className="text-sm text-muted-foreground">{filtered.length} batch{filtered.length !== 1 ? "es" : ""}</p>
              </div>
            </div>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" /> New Batch
            </Button>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex gap-3">
                <Select value={carrierFilter} onValueChange={setCarrierFilter}>
                  <SelectTrigger className="w-[220px]"><SelectValue placeholder="All Carriers" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Carriers</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch Name</TableHead>
                    <TableHead>Carrier</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No batches found. Create your first one.</TableCell></TableRow>
                  ) : filtered.map((b) => (
                    <TableRow key={b.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailBatch(b)}>
                      <TableCell className="font-medium">{b.batchName}</TableCell>
                      <TableCell>{clientMap[b.carrierId] ?? `Carrier #${b.carrierId}`}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.invoiceCount}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmt(b.totalAmount)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <StatusBadge status={b.status} map={BATCH_STATUS_STYLES} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(b.submittedAt)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(b.createdAt)}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setDetailBatch(b)}>View Items</DropdownMenuItem>
                            {b.status === "draft" && (
                              <DropdownMenuItem onClick={() => statusMutation.mutate({ id: b.id, status: "submitted" })}>
                                Submit
                              </DropdownMenuItem>
                            )}
                            {b.status === "submitted" && (
                              <DropdownMenuItem onClick={() => statusMutation.mutate({ id: b.id, status: "processing" })}>
                                Mark Processing
                              </DropdownMenuItem>
                            )}
                            {b.status === "processing" && (
                              <DropdownMenuItem onClick={() => statusMutation.mutate({ id: b.id, status: "completed" })}>
                                Mark Completed
                              </DropdownMenuItem>
                            )}
                            {b.status === "draft" && (
                              <DropdownMenuItem className="text-destructive" onClick={() => deleteMutation.mutate(b.id)}>
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </main>
      </div>

      {/* Create Batch Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Invoice Batch</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="batchName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Batch Name <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input placeholder="e.g. Week-27-2024" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="carrierId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Carrier <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select carrier…" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <Separator />

              {/* Invoice rows */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-medium">Invoice Lines</p>
                    <p className="text-xs text-muted-foreground">Running total: <strong>{fmt(runningTotal)}</strong></p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => append({ invoiceNumber: "", loadNumber: "", amount: 0, brokerName: "", notes: "" })}
                  >
                    <PlusCircle className="h-3.5 w-3.5" /> Add Row
                  </Button>
                </div>

                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_1fr_120px_1fr_32px] gap-2 px-1">
                    <span className="text-xs text-muted-foreground font-medium">Invoice #</span>
                    <span className="text-xs text-muted-foreground font-medium">Load #</span>
                    <span className="text-xs text-muted-foreground font-medium">Amount ($)</span>
                    <span className="text-xs text-muted-foreground font-medium">Broker</span>
                    <span />
                  </div>

                  {fields.map((field, idx) => (
                    <div key={field.id} className="grid grid-cols-[1fr_1fr_120px_1fr_32px] gap-2 items-start">
                      <FormField control={form.control} name={`items.${idx}.invoiceNumber`} render={({ field: f }) => (
                        <FormItem className="space-y-0">
                          <FormControl><Input placeholder="INV-001" {...f} /></FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`items.${idx}.loadNumber`} render={({ field: f }) => (
                        <FormItem className="space-y-0">
                          <FormControl><Input placeholder="LD-1234" {...f} /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`items.${idx}.amount`} render={({ field: f }) => (
                        <FormItem className="space-y-0">
                          <FormControl>
                            <Input type="number" step="0.01" min="0" placeholder="0.00" {...f}
                              onChange={(e) => f.onChange(parseFloat(e.target.value) || 0)} />
                          </FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`items.${idx}.brokerName`} render={({ field: f }) => (
                        <FormItem className="space-y-0">
                          <FormControl><Input placeholder="Broker name" {...f} /></FormControl>
                        </FormItem>
                      )} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => fields.length > 1 && remove(idx)}
                        disabled={fields.length === 1}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                {form.formState.errors.items?.root && (
                  <p className="text-xs text-destructive mt-1">{form.formState.errors.items.root.message}</p>
                )}
              </div>

              <div className="rounded-md bg-muted/50 px-4 py-3 flex justify-between items-center text-sm">
                <span className="text-muted-foreground">{fields.length} invoice{fields.length !== 1 ? "s" : ""}</span>
                <span className="font-semibold">Total: {fmt(runningTotal)}</span>
              </div>

              <Separator />
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating…" : "Create Batch"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
