import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectItem, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Plus, Edit, UserX, Phone, Mail, Search, Headset } from "lucide-react";
import {
  OperationsBadge,
  OperationsButton as Button,
  OperationsCard as Card,
  OperationsDialogContent as DialogContent,
  OperationsInput as Input,
  OperationsSelectContent as SelectContent,
  OperationsSelectTrigger as SelectTrigger,
} from "@/components/operations/operations-controls";
import {
  NeuPageShell,
  NeuStatCard,
  NeuTable as Table,
  NeuTableBody as TableBody,
  NeuTableCell as TableCell,
  NeuTableHead as TableHead,
  NeuTableHeader as TableHeader,
  NeuTableRow as TableRow,
} from "@/styles/neu/components";
import "@/components/operations/operations-neu.css";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Dispatcher {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  carrierId: number | null;
  status: "active" | "inactive";
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
}

interface Client {
  id: number;
  name: string;
}

// ─── Form Schema ──────────────────────────────────────────────────────────────

const dispatcherFormSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email required").optional().or(z.literal("")),
  phone: z.string().optional(),
  carrierId: z.coerce.number().nullable().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
  notes: z.string().optional(),
});

type DispatcherFormData = z.infer<typeof dispatcherFormSchema>;

// ─── Component ────────────────────────────────────────────────────────────────

export default function Dispatchers() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Dispatcher | null>(null);
  const [search, setSearch] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("search") ?? "",
  );
  const [carrierFilter, setCarrierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const form = useForm<DispatcherFormData>({
    resolver: zodResolver(dispatcherFormSchema),
    defaultValues: {
      firstName: "", lastName: "", email: "", phone: "",
      carrierId: null, status: "active", notes: "",
    },
  });

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: dispatchers = [], isLoading } = useQuery<Dispatcher[]>({
    queryKey: ["/api/dispatchers", { all: true }],
  });

  const { data: carriers = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients", { all: true }],
  });

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: Omit<DispatcherFormData, "email"> & { email?: string | null }) =>
      apiRequest("POST", "/api/dispatchers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatchers"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Dispatcher added" });
    },
    onError: () => toast({ title: "Failed to add dispatcher", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Omit<DispatcherFormData, "email"> & { email?: string | null }> }) =>
      apiRequest("PATCH", `/api/dispatchers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatchers"] });
      setDialogOpen(false);
      setEditing(null);
      form.reset();
      toast({ title: "Dispatcher updated" });
    },
    onError: () => toast({ title: "Failed to update dispatcher", variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/dispatchers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatchers"] });
      toast({ title: "Dispatcher deactivated" });
    },
    onError: () => toast({ title: "Failed to deactivate dispatcher", variant: "destructive" }),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    form.reset({
      firstName: "", lastName: "", email: "", phone: "",
      carrierId: null, status: "active", notes: "",
    });
    setDialogOpen(true);
  }

  function openEdit(d: Dispatcher) {
    setEditing(d);
    form.reset({
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email ?? "",
      phone: d.phone ?? "",
      carrierId: d.carrierId ?? null,
      status: d.status,
      notes: d.notes ?? "",
    });
    setDialogOpen(true);
  }

  function onSubmit(data: DispatcherFormData) {
    const payload = { ...data, carrierId: data.carrierId || null, email: data.email || null };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  // ─── Filtered list ─────────────────────────────────────────────────────────

  const carrierMap = Object.fromEntries(carriers.map((c) => [c.id, c.name]));

  const filtered = dispatchers.filter((d) => {
    const full = `${d.firstName} ${d.lastName} ${d.email ?? ""} ${d.phone ?? ""}`.toLowerCase();
    const matchSearch = !search || full.includes(search.toLowerCase());
    const matchCarrier = carrierFilter === "all" || String(d.carrierId) === carrierFilter;
    const matchStatus = statusFilter === "all" || d.status === statusFilter;
    return matchSearch && matchCarrier && matchStatus;
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="operations-neu-page ff-dispatchers-page flex min-h-[100dvh] overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopNav title="Dispatchers" neu />
        <NeuPageShell className="!min-h-0 flex-1 overflow-y-auto p-6 space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Headset className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Dispatchers</h1>
                <p className="text-sm text-muted-foreground">
                  {filtered.length} dispatcher{filtered.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Add Dispatcher
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Filtered Dispatchers", value: filtered.length },
              { label: "Active Dispatchers", value: dispatchers.filter((d) => d.status === "active").length },
              { label: "Carrier Linked", value: dispatchers.filter((d) => d.carrierId !== null).length },
            ].map((stat) => (
              <NeuStatCard key={stat.label} label={stat.label} value={stat.value} icon={<Headset className="h-5 w-5" />} className="operations-neu-surface min-h-32 p-4" />
            ))}
          </div>

          {/* Filters */}
            <Card className="operations-neu-surface">
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search dispatchers..."
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Select value={carrierFilter} onValueChange={setCarrierFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All carriers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Carriers</SelectItem>
                    {carriers.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card className="ff-table-container operations-neu-surface overflow-hidden">
            <CardContent className="p-0">
              <Table className="ff-data-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Linked Carrier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        No dispatchers found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">
                          {d.firstName} {d.lastName}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5 text-sm">
                            {d.email && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Mail className="h-3 w-3" />{d.email}
                              </span>
                            )}
                            {d.phone && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Phone className="h-3 w-3" />{d.phone}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {d.carrierId ? (
                            <OperationsBadge className="ff-badge ff-badge-submitted">{carrierMap[d.carrierId] ?? `#${d.carrierId}`}</OperationsBadge>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <OperationsBadge className={`ff-badge ${d.status === "active" ? "ff-badge-funded" : "ff-badge-draft"}`}>
                            {d.status === "active" ? "Active" : "Inactive"}
                          </OperationsBadge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Edit ${d.firstName} ${d.lastName}`}
                              onClick={() => openEdit(d)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            {d.status === "active" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                aria-label={`Deactivate ${d.firstName} ${d.lastName}`}
                                onClick={() => deactivateMutation.mutate(d.id)}
                                disabled={deactivateMutation.isPending}
                              >
                                <UserX className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </NeuPageShell>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="operations-neu-dialog max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Dispatcher" : "Add Dispatcher"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl><Input placeholder="John" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl><Input placeholder="Smith" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input placeholder="john@carrier.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl><Input placeholder="(555) 000-0000" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="carrierId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Linked Carrier</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : "none"}
                      onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select carrier…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No carrier</SelectItem>
                        {carriers.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Optional notes…" rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editing ? "Save Changes" : "Add Dispatcher"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
