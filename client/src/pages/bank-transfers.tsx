import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus, MoreHorizontal, Download, Landmark,
  CheckCircle2, Clock, XCircle, Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BankTransfer {
  id: number;
  transferType: "ACH" | "wire";
  amount: string;
  carrierId: number | null;
  bankAccountName: string | null;
  routingNumber: string | null;
  memo: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  transferDate: string | null;
  confirmedAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

interface Client { id: number; name: string; }

// ─── Form Schema ──────────────────────────────────────────────────────────────

const formSchema = z.object({
  transferType: z.enum(["ACH", "wire"]),
  amount: z.coerce.number().positive("Amount must be positive"),
  carrierId: z.coerce.number().nullable().optional(),
  bankAccountName: z.string().optional(),
  routingNumber: z.string().optional(),
  accountNumber: z.string().optional(),
  memo: z.string().optional(),
  transferDate: z.string().optional(),
  status: z.enum(["pending", "processing", "completed", "failed"]).default("pending"),
});

type FormData = z.infer<typeof formSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive"; icon: any }> = {
  pending:    { label: "Pending",    variant: "secondary",   icon: Clock       },
  processing: { label: "Processing", variant: "default",     icon: Loader2     },
  completed:  { label: "Completed",  variant: "default",     icon: CheckCircle2 },
  failed:     { label: "Failed",     variant: "destructive", icon: XCircle     },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, variant: "secondary", icon: Clock };
  return (
    <Badge variant={cfg.variant} className={status === "completed" ? "bg-green-600 hover:bg-green-700" : undefined}>
      {cfg.label}
    </Badge>
  );
}

function fmt(n: string | number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function exportCSV(rows: BankTransfer[], carrierMap: Record<number, string>) {
  const header = ["ID", "Date", "Type", "Carrier", "Bank Account", "Amount", "Status", "Memo"];
  const body = rows.map((r) => [
    r.id,
    fmtDate(r.transferDate ?? r.createdAt),
    r.transferType,
    r.carrierId ? carrierMap[r.carrierId] ?? r.carrierId : "",
    r.bankAccountName ?? "",
    Number(r.amount).toFixed(2),
    r.status,
    (r.memo ?? "").replace(/,/g, ";"),
  ]);
  const csv = [header, ...body].map((row) => row.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bank-transfers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BankTransfers() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BankTransfer | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      transferType: "ACH", amount: 0, carrierId: null,
      bankAccountName: "", routingNumber: "", accountNumber: "",
      memo: "", transferDate: "", status: "pending",
    },
  });

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: transfers = [], isLoading } = useQuery<BankTransfer[]>({
    queryKey: ["/api/bank-transfers"],
  });

  const { data: carriers = [] } = useQuery<Client[]>({ queryKey: ["/api/clients"] });

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: FormData) => apiRequest("POST", "/api/bank-transfers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transfers"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Transfer created" });
    },
    onError: () => toast({ title: "Failed to create transfer", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/bank-transfers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transfers"] });
      setDialogOpen(false);
      setEditing(null);
      form.reset();
      toast({ title: "Transfer updated" });
    },
    onError: () => toast({ title: "Failed to update transfer", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/bank-transfers/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-transfers"] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    form.reset({
      transferType: "ACH", amount: 0, carrierId: null,
      bankAccountName: "", routingNumber: "", accountNumber: "",
      memo: "", transferDate: new Date().toISOString().slice(0, 10), status: "pending",
    });
    setDialogOpen(true);
  }

  function openEdit(t: BankTransfer) {
    setEditing(t);
    form.reset({
      transferType: t.transferType,
      amount: Number(t.amount),
      carrierId: t.carrierId ?? null,
      bankAccountName: t.bankAccountName ?? "",
      routingNumber: t.routingNumber ?? "",
      accountNumber: "",
      memo: t.memo ?? "",
      transferDate: t.transferDate ? t.transferDate.slice(0, 10) : "",
      status: t.status,
    });
    setDialogOpen(true);
  }

  function onSubmit(data: FormData) {
    const payload = {
      ...data,
      carrierId: data.carrierId || null,
      bankAccountName: data.bankAccountName || null,
      routingNumber: data.routingNumber || null,
      accountNumber: data.accountNumber || undefined,
      memo: data.memo || null,
      transferDate: data.transferDate || null,
    };
    if (editing) updateMutation.mutate({ id: editing.id, data: payload });
    else createMutation.mutate(payload);
  }

  // ─── Filter + lookup ───────────────────────────────────────────────────────

  const carrierMap = Object.fromEntries(carriers.map((c) => [c.id, c.name]));

  const filtered = transfers.filter((t) => {
    const matchType = typeFilter === "all" || t.transferType === typeFilter;
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    const tDate = t.transferDate ?? t.createdAt;
    const matchFrom = !dateFrom || tDate >= dateFrom;
    const matchTo = !dateTo || tDate <= dateTo + "T23:59:59";
    return matchType && matchStatus && matchFrom && matchTo;
  });

  const totalFiltered = filtered.reduce((sum, t) => sum + Number(t.amount), 0);

  // ─── Render ────────────────────────────────────────────────────────────────

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
                <Landmark className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Bank Transfers</h1>
                <p className="text-sm text-muted-foreground">
                  {filtered.length} transfer{filtered.length !== 1 ? "s" : ""} · {fmt(totalFiltered)} total
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => exportCSV(filtered, carrierMap)} className="gap-2">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
              <Button onClick={openCreate} className="gap-2">
                <Plus className="h-4 w-4" /> New Transfer
              </Button>
            </div>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="ACH">ACH</SelectItem>
                    <SelectItem value="wire">Wire</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    className="w-[160px]"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    placeholder="From"
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input
                    type="date"
                    className="w-[160px]"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    placeholder="To"
                  />
                  {(dateFrom || dateTo) && (
                    <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Carrier</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Bank Account</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        No transfers found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-sm">
                          {fmtDate(t.transferDate ?? t.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {t.carrierId ? carrierMap[t.carrierId] ?? `#${t.carrierId}` : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={t.transferType === "ACH" ? "secondary" : "outline"}>
                            {t.transferType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {t.bankAccountName ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {fmt(t.amount)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={t.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(t)}>
                                Edit
                              </DropdownMenuItem>
                              {t.status === "pending" && (
                                <DropdownMenuItem onClick={() => statusMutation.mutate({ id: t.id, status: "processing" })}>
                                  Mark Processing
                                </DropdownMenuItem>
                              )}
                              {(t.status === "pending" || t.status === "processing") && (
                                <DropdownMenuItem onClick={() => statusMutation.mutate({ id: t.id, status: "completed" })}>
                                  Mark Completed
                                </DropdownMenuItem>
                              )}
                              {t.status !== "completed" && t.status !== "failed" && (
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => statusMutation.mutate({ id: t.id, status: "failed" })}
                                >
                                  Mark Failed
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </main>
      </div>

      {/* New / Edit Transfer Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Transfer" : "New Transfer"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              {/* Type + Date */}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="transferType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="ACH">ACH</SelectItem>
                        <SelectItem value="wire">Wire</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="transferDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Transfer Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Carrier + Amount */}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="carrierId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Carrier</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : "none"}
                      onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder="Select carrier…" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none">No carrier</SelectItem>
                        {carriers.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Bank Account Name */}
              <FormField control={form.control} name="bankAccountName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank Account Name</FormLabel>
                  <FormControl><Input placeholder="First National Bank - Checking" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Routing + Account */}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="routingNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Routing Number</FormLabel>
                    <FormControl><Input placeholder="021000021" maxLength={9} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="accountNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Number</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={editing ? "Leave blank to keep" : "Enter account number"}
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Status (edit only) */}
              {editing && (
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="processing">Processing</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {/* Memo */}
              <FormField control={form.control} name="memo" render={({ field }) => (
                <FormItem>
                  <FormLabel>Memo</FormLabel>
                  <FormControl><Textarea placeholder="Optional memo…" rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editing ? "Save Changes" : "Create Transfer"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
