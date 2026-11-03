import { useState } from "react";
import { AdminPageShell, Button, Input, Badge, Card, CardContent, DialogContent, SelectContent, useAdminToast, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, StatCard } from "@/components/admin-neu/adapters";
import "@/components/admin-neu/admin-neu-page.css";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Sidebar from "@/components/layout/sidebar";
import { TopNav } from "@/components/admin-neu/adapters";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, MoreHorizontal, Download, BadgeDollarSign, Trash2, PlusCircle, LockKeyhole } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayrollDeduction {
  id?: number;
  deductionType: "tax" | "insurance" | "other";
  amount: string;
  description: string | null;
}

interface PayrollEntry {
  id: number;
  employeeId: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  regularHours: string;
  overtimeHours: string;
  hourlyRate: string;
  grossPay: string;
  deductions: string;
  netPay: string;
  status: "draft" | "approved" | "paid";
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  deductionsList?: PayrollDeduction[];
}

interface User { id: string; firstName: string; lastName: string; role: string; email: string; }

// ─── Form Schema ──────────────────────────────────────────────────────────────

const deductionSchema = z.object({
  deductionType: z.enum(["tax", "insurance", "other"]),
  amount: z.coerce.number().min(0),
  description: z.string().optional(),
});

const formSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  payPeriodStart: z.string().min(1, "Start date required"),
  payPeriodEnd: z.string().min(1, "End date required"),
  regularHours: z.coerce.number().min(0).default(0),
  overtimeHours: z.coerce.number().min(0).default(0),
  hourlyRate: z.coerce.number().positive("Rate required"),
  notes: z.string().optional(),
  deductions: z.array(deductionSchema).default([]),
});

type FormData = z.infer<typeof formSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const STATUS_COLOR: Record<string, string> = {
  draft: "ff-badge-draft",
  approved: "ff-badge-submitted",
  paid: "ff-badge-funded",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`ff-badge ${STATUS_COLOR[status] ?? "ff-badge-draft"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function calcGross(regular: number, overtime: number, rate: number) {
  return regular * rate + overtime * rate * 1.5;
}

function exportCSV(entries: PayrollEntry[], userMap: Record<string, string>) {
  const header = ["ID", "Employee", "Period Start", "Period End", "Reg Hours", "OT Hours", "Rate", "Gross", "Deductions", "Net", "Status"];
  const body = entries.map((e) => [
    e.id,
    userMap[e.employeeId] ?? e.employeeId,
    fmtDate(e.payPeriodStart),
    fmtDate(e.payPeriodEnd),
    e.regularHours,
    e.overtimeHours,
    Number(e.hourlyRate).toFixed(2),
    Number(e.grossPay).toFixed(2),
    Number(e.deductions).toFixed(2),
    Number(e.netPay).toFixed(2),
    e.status,
  ]);
  const csv = [header, ...body].map((r) => r.join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `Trucking_Pros_Financial_payroll-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Payroll() {
  const { toast } = useAdminToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PayrollEntry | null>(null);
  const [empFilter, setEmpFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      employeeId: "", payPeriodStart: "", payPeriodEnd: "",
      regularHours: 0, overtimeHours: 0, hourlyRate: 0,
      notes: "", deductions: [],
    },
  });

  const { fields: deductionFields, append: appendDeduction, remove: removeDeduction } = useFieldArray({
    control: form.control,
    name: "deductions",
  });

  const watchRegular = form.watch("regularHours");
  const watchOvertime = form.watch("overtimeHours");
  const watchRate = form.watch("hourlyRate");
  const watchDeductions = form.watch("deductions");
  const computedGross = calcGross(Number(watchRegular), Number(watchOvertime), Number(watchRate));
  const totalDeductions = watchDeductions.reduce((s, d) => s + Number(d.amount || 0), 0);
  const computedNet = computedGross - totalDeductions;

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: entries = [], isLoading } = useQuery<PayrollEntry[]>({ queryKey: ["/api/payroll"] });
  const { data: users = [] } = useQuery<User[]>({ queryKey: ["/api/admin/users"] });
  const { data: authData } = useQuery<{ user: User }>({ queryKey: ["/api/auth/user"] });

  const isManager = authData?.user?.role === "admin" || authData?.user?.role === "manager";
  const userMap = Object.fromEntries(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const employees = users.filter((u) => u.role !== undefined);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/payroll", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll"] }); setDialogOpen(false); form.reset(); toast({ title: "Payroll entry created" }); },
    onError: async (e: any) => {
      let msg = "Failed to create entry";
      try { const j = await e?.response?.json?.(); if (j?.message) msg = j.message; } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/payroll/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll"] }); setDialogOpen(false); setEditing(null); form.reset(); toast({ title: "Entry updated" }); },
    onError: (e: any) => toast({ title: e?.message ?? "Failed to update", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiRequest("PATCH", `/api/payroll/${id}`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll"] }); toast({ title: "Status updated" }); },
    onError: (e: any) => toast({ title: e?.message ?? "Failed to update status", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/payroll/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll"] }); toast({ title: "Entry deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    const today = new Date().toISOString().slice(0, 10);
    form.reset({ employeeId: "", payPeriodStart: today, payPeriodEnd: today, regularHours: 40, overtimeHours: 0, hourlyRate: 0, notes: "", deductions: [] });
    setDialogOpen(true);
  }

  function openEdit(e: PayrollEntry) {
    setEditing(e);
    form.reset({
      employeeId: e.employeeId,
      payPeriodStart: e.payPeriodStart.slice(0, 10),
      payPeriodEnd: e.payPeriodEnd.slice(0, 10),
      regularHours: Number(e.regularHours),
      overtimeHours: Number(e.overtimeHours),
      hourlyRate: Number(e.hourlyRate),
      notes: e.notes ?? "",
      deductions: (e.deductionsList ?? []).map((d) => ({
        deductionType: d.deductionType,
        amount: Number(d.amount),
        description: d.description ?? "",
      })),
    });
    setDialogOpen(true);
  }

  function onSubmit(data: FormData) {
    const gross = calcGross(data.regularHours, data.overtimeHours, data.hourlyRate);
    const dedTotal = data.deductions.reduce((s, d) => s + Number(d.amount), 0);
    const payload = {
      employeeId: data.employeeId,
      payPeriodStart: data.payPeriodStart,
      payPeriodEnd: data.payPeriodEnd,
      regularHours: String(data.regularHours),
      overtimeHours: String(data.overtimeHours),
      hourlyRate: String(data.hourlyRate),
      grossPay: gross.toFixed(2),
      deductionsTotal: dedTotal.toFixed(2),
      netPay: (gross - dedTotal).toFixed(2),
      notes: data.notes ?? "",
      deductionItems: data.deductions,
    };
    if (editing) updateMutation.mutate({ id: editing.id, data: payload });
    else createMutation.mutate(payload);
  }

  // ─── Filter ────────────────────────────────────────────────────────────────

  const filtered = entries.filter((e) => {
    const matchEmp = empFilter === "all" || e.employeeId === empFilter;
    const matchStatus = statusFilter === "all" || e.status === statusFilter;
    const matchFrom = !dateFrom || e.payPeriodStart >= dateFrom;
    const matchTo = !dateTo || e.payPeriodEnd <= dateTo;
    return matchEmp && matchStatus && matchFrom && matchTo;
  });

  const totals = filtered.reduce((acc, e) => ({
    gross: acc.gross + Number(e.grossPay),
    ded: acc.ded + Number(e.deductions),
    net: acc.net + Number(e.netPay),
  }), { gross: 0, ded: 0, net: 0 });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="ff-payroll-page flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopNav title="Payroll" />
        <AdminPageShell className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <BadgeDollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Payroll</h1>
                <p className="text-sm text-muted-foreground">
                  {filtered.length} entr{filtered.length !== 1 ? "ies" : "y"} · {fmt(totals.gross)} gross · {fmt(totals.net)} net
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => exportCSV(filtered, userMap)} className="gap-2">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
              <Button onClick={openCreate} className="gap-2">
                <Plus className="h-4 w-4" /> New Entry
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "Gross Payroll", value: fmt(totals.gross) },
              { label: "Deductions", value: fmt(totals.ded) },
              { label: "Net Payroll", value: fmt(totals.net) },
              { label: "Paid Entries", value: String(filtered.filter((entry) => entry.status === "paid").length) },
            ].map((stat) => (
              <StatCard key={stat.label} label={stat.label} value={stat.value} className="ff-payroll-surface ff-stat-card min-h-0 p-4" />
            ))}
          </div>

          {/* Filters */}
          <Card className="ff-payroll-surface">
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3">
                <Select value={empFilter} onValueChange={setEmpFilter}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Employees" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Employees</SelectItem>
                    {employees.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Input type="date" className="w-[155px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input type="date" className="w-[155px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                  {(dateFrom || dateTo) && (
                    <Button variant="outline" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear</Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card className="ff-payroll-surface">
            <CardContent className="p-0">
              <Table className="ff-data-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Pay Period</TableHead>
                    <TableHead className="text-right">Reg / OT Hrs</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net Pay</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No payroll entries found.</TableCell></TableRow>
                  ) : filtered.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="ff-payroll-avatar">
                            {(userById[e.employeeId]?.firstName?.[0] ?? "?")}{userById[e.employeeId]?.lastName?.[0] ?? ""}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{userMap[e.employeeId] ?? e.employeeId}</p>
                            <p className="text-[10px] text-slate-500">{userById[e.employeeId]?.role ?? "Employee"}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="ff-payroll-period text-sm">
                        {fmtDate(e.payPeriodStart)} – {fmtDate(e.payPeriodEnd)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {Number(e.regularHours).toFixed(1)} / {Number(e.overtimeHours).toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmt(e.grossPay)}</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">{fmt(e.deductions)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmt(e.netPay)}</TableCell>
                      <TableCell><StatusBadge status={e.status} /></TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {e.status === "draft" && (
                              <DropdownMenuItem onClick={() => openEdit(e)}>Edit</DropdownMenuItem>
                            )}
                            {isManager && e.status === "draft" && (
                              <DropdownMenuItem className="ff-payroll-action-approve" onClick={() => statusMutation.mutate({ id: e.id, status: "approved" })}>
                                Approve
                              </DropdownMenuItem>
                            )}
                            {isManager && e.status === "approved" && (
                              <DropdownMenuItem className="ff-payroll-action-paid" onClick={() => statusMutation.mutate({ id: e.id, status: "paid" })}>
                                Mark Paid
                              </DropdownMenuItem>
                            )}
                            {e.status === "draft" && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => deleteMutation.mutate(e.id)}
                              >
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {!isManager && e.status !== "paid" && (
                          <span className="ff-badge ff-badge-draft ml-1 gap-1" title="Manager or administrator approval required">
                            <LockKeyhole className="h-3 w-3" /> Restricted
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </AdminPageShell>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="ff-payroll-surface max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Payroll Entry" : "New Payroll Entry"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              {/* Employee */}
              <FormField control={form.control} name="employeeId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee <span className="text-destructive">*</span></FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select employee…" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {employees.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Pay Period */}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="payPeriodStart" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Period Start <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="payPeriodEnd" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Period End <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Hours + Rate */}
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="regularHours" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Regular Hours</FormLabel>
                    <FormControl><Input type="number" step="0.5" min="0" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="overtimeHours" render={({ field }) => (
                  <FormItem>
                    <FormLabel>OT Hours</FormLabel>
                    <FormControl><Input type="number" step="0.5" min="0" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="hourlyRate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hourly Rate ($) <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="number" step="0.01" min="0" placeholder="0.00" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Auto-computed preview */}
              <div className="ff-payroll-surface bg-muted/50 px-4 py-3 grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Gross Pay</p>
                  <p className="font-semibold">{fmt(computedGross)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total Deductions</p>
                  <p className="font-semibold text-destructive">{fmt(totalDeductions)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Net Pay</p>
                  <p className="font-semibold text-green-600">{fmt(computedNet)}</p>
                </div>
              </div>

              {/* Deductions */}
              <div className="ff-payroll-deductions ff-payroll-surface">
                <div className="ff-payroll-section-header flex items-center justify-between px-3 py-2">
                  <FormLabel>Deductions</FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => appendDeduction({ deductionType: "tax", amount: 0, description: "" })}
                  >
                    <PlusCircle className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
                <div className="space-y-2 p-3">
                  {deductionFields.map((field, idx) => (
                    <div key={field.id} className="ff-payroll-surface flex gap-2 items-start bg-white p-2">
                      <FormField control={form.control} name={`deductions.${idx}.deductionType`} render={({ field: f }) => (
                        <Select value={f.value} onValueChange={f.onChange}>
                          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="tax">Tax</SelectItem>
                            <SelectItem value="insurance">Insurance</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      )} />
                      <FormField control={form.control} name={`deductions.${idx}.amount`} render={({ field: f }) => (
                        <Input type="number" step="0.01" min="0" placeholder="0.00" className="w-[110px]" {...f} onChange={(e) => f.onChange(parseFloat(e.target.value) || 0)} />
                      )} />
                      <FormField control={form.control} name={`deductions.${idx}.description`} render={({ field: f }) => (
                        <Input placeholder="Description" className="flex-1" {...f} />
                      )} />
                      <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => removeDeduction(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea placeholder="Optional notes…" rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <Separator />
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editing ? "Save Changes" : "Create Entry"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
