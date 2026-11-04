import { useState } from "react";
import { PageInsights } from "@/components/PageInsights";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectItem, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Edit, PowerOff, Search, Truck as TruckIcon } from "lucide-react";
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

interface TruckRow {
  id: number;
  truckNumber: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  licensePlate: string | null;
  state: string | null;
  carrierId: number | null;
  dispatcherId: number | null;
  status: "active" | "inactive" | "out-of-service";
  notes: string | null;
  createdAt: string;
}

interface Client { id: number; name: string; }
interface Dispatcher { id: number; firstName: string; lastName: string; }

// ─── Form Schema ──────────────────────────────────────────────────────────────

const truckFormSchema = z.object({
  truckNumber: z.string().min(1, "Truck number is required"),
  vin: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
  licensePlate: z.string().optional(),
  state: z.string().optional(),
  carrierId: z.coerce.number().nullable().optional(),
  dispatcherId: z.coerce.number().nullable().optional(),
  status: z.enum(["active", "inactive", "out-of-service"]).default("active"),
  notes: z.string().optional(),
});

type TruckFormData = z.infer<typeof truckFormSchema>;

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    active: { label: "Active", className: "ff-badge-funded" },
    inactive: { label: "Inactive", className: "ff-badge-draft" },
    "out-of-service": { label: "Out of Service", className: "ff-badge-rejected" },
  };
  const badge = map[status] ?? { label: status, className: "ff-badge-draft" };
  return <OperationsBadge className={`ff-badge ${badge.className}`}>{badge.label}</OperationsBadge>;
}

// ─── Component ────────────────────────────────────────────────────────────────

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

export default function Trucks() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TruckRow | null>(null);
  const [search, setSearch] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("search") ?? "",
  );
  const [carrierFilter, setCarrierFilter] = useState("all");
  const [dispatcherFilter, setDispatcherFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const form = useForm<TruckFormData>({
    resolver: zodResolver(truckFormSchema),
    defaultValues: {
      truckNumber: "", vin: "", make: "", model: "", year: null,
      licensePlate: "", state: "", carrierId: null, dispatcherId: null,
      status: "active", notes: "",
    },
  });

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: truckList = [], isLoading } = useQuery<TruckRow[]>({
    queryKey: ["/api/trucks", { all: true }],
  });

  const { data: carriers = [] } = useQuery<Client[]>({ queryKey: ["/api/clients", { all: true }] });
  const { data: dispatchers = [] } = useQuery<Dispatcher[]>({ queryKey: ["/api/dispatchers", { all: true }] });

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: Omit<TruckFormData, "vin" | "make" | "model" | "licensePlate" | "state" | "notes"> & {
      [K in "vin" | "make" | "model" | "licensePlate" | "state" | "notes"]?: string | null;
    }) => apiRequest("POST", "/api/trucks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Truck added" });
    },
    onError: () => toast({ title: "Failed to add truck", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Omit<TruckFormData, "vin" | "make" | "model" | "licensePlate" | "state" | "notes"> & {
      [K in "vin" | "make" | "model" | "licensePlate" | "state" | "notes"]?: string | null;
    }> }) =>
      apiRequest("PATCH", `/api/trucks/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      setDialogOpen(false);
      setEditing(null);
      form.reset();
      toast({ title: "Truck updated" });
    },
    onError: () => toast({ title: "Failed to update truck", variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/trucks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      toast({ title: "Truck deactivated" });
    },
    onError: () => toast({ title: "Failed to deactivate", variant: "destructive" }),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    form.reset({
      truckNumber: "", vin: "", make: "", model: "", year: null,
      licensePlate: "", state: "", carrierId: null, dispatcherId: null,
      status: "active", notes: "",
    });
    setDialogOpen(true);
  }

  function openEdit(t: TruckRow) {
    setEditing(t);
    form.reset({
      truckNumber: t.truckNumber,
      vin: t.vin ?? "",
      make: t.make ?? "",
      model: t.model ?? "",
      year: t.year ?? null,
      licensePlate: t.licensePlate ?? "",
      state: t.state ?? "",
      carrierId: t.carrierId ?? null,
      dispatcherId: t.dispatcherId ?? null,
      status: t.status,
      notes: t.notes ?? "",
    });
    setDialogOpen(true);
  }

  function onSubmit(data: TruckFormData) {
    const clean = {
      ...data,
      carrierId: data.carrierId || null,
      dispatcherId: data.dispatcherId || null,
      year: data.year || null,
      vin: data.vin || null,
      make: data.make || null,
      model: data.model || null,
      licensePlate: data.licensePlate || null,
      state: data.state || null,
      notes: data.notes || null,
    };
    if (editing) updateMutation.mutate({ id: editing.id, data: clean });
    else createMutation.mutate(clean);
  }

  // ─── Lookup maps ───────────────────────────────────────────────────────────

  const carrierMap = Object.fromEntries(carriers.map((c) => [c.id, c.name]));
  const dispatcherMap = Object.fromEntries(
    dispatchers.map((d) => [d.id, `${d.firstName} ${d.lastName}`])
  );

  // ─── Filtered list ─────────────────────────────────────────────────────────

  const filtered = truckList.filter((t) => {
    const hay = `${t.truckNumber} ${t.vin ?? ""} ${t.make ?? ""} ${t.model ?? ""} ${t.licensePlate ?? ""}`.toLowerCase();
    const matchSearch = !search || hay.includes(search.toLowerCase());
    const matchCarrier = carrierFilter === "all" || String(t.carrierId) === carrierFilter;
    const matchDispatcher = dispatcherFilter === "all" || String(t.dispatcherId) === dispatcherFilter;
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    return matchSearch && matchCarrier && matchDispatcher && matchStatus;
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="operations-neu-page ff-trucks-page flex min-h-[100dvh] overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopNav title="Trucks" neu />
        <NeuPageShell className="!min-h-0 flex-1 overflow-y-auto p-6 space-y-6">
          <PageInsights entity="trucks" title="Fleet operations" />

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <TruckIcon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Trucks</h1>
                <p className="text-sm text-muted-foreground">
                  {filtered.length} truck{filtered.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Add Truck
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Filtered Trucks", value: filtered.length },
              { label: "Active Trucks", value: truckList.filter((truck) => truck.status === "active").length },
              { label: "Out of Service", value: truckList.filter((truck) => truck.status === "out-of-service").length },
            ].map((stat) => (
              <NeuStatCard key={stat.label} label={stat.label} value={stat.value} icon={<TruckIcon className="h-5 w-5" />} className="operations-neu-surface min-h-32 p-4" />
            ))}
          </div>

          {/* Filters */}
          <Card className="operations-neu-surface">
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search trucks…"
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Select value={carrierFilter} onValueChange={setCarrierFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All carriers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Carriers</SelectItem>
                    {carriers.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={dispatcherFilter} onValueChange={setDispatcherFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All dispatchers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Dispatchers</SelectItem>
                    {dispatchers.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.firstName} {d.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="out-of-service">Out of Service</SelectItem>
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
                    <TableHead>Truck #</TableHead>
                    <TableHead>VIN</TableHead>
                    <TableHead>Make / Model / Year</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Carrier</TableHead>
                    <TableHead>Dispatcher</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                        No trucks found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.truckNumber}</TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono">
                          {t.vin ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {[t.make, t.model, t.year].filter(Boolean).join(" ") || "—"}
                        </TableCell>
                        <TableCell className="text-sm">{t.licensePlate ?? "—"}</TableCell>
                        <TableCell className="text-sm">{t.state ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {t.carrierId ? <OperationsBadge className="ff-badge ff-badge-submitted">{carrierMap[t.carrierId] ?? `#${t.carrierId}`}</OperationsBadge> : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {t.dispatcherId ? <OperationsBadge className="ff-badge ff-badge-approved">{dispatcherMap[t.dispatcherId] ?? `#${t.dispatcherId}`}</OperationsBadge> : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={t.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button size="sm" variant="outline" aria-label={`Edit truck ${t.truckNumber}`} onClick={() => openEdit(t)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            {t.status === "active" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                aria-label={`Deactivate truck ${t.truckNumber}`}
                                onClick={() => deactivateMutation.mutate(t.id)}
                                disabled={deactivateMutation.isPending}
                              >
                                <PowerOff className="h-4 w-4" />
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
        <DialogContent className="operations-neu-dialog max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Truck" : "Add Truck"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              {/* Row 1: Truck # + VIN */}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="truckNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Truck Number <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input placeholder="T-1001" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="vin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>VIN</FormLabel>
                    <FormControl><Input placeholder="1HGCM82633A004352" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Row 2: Make / Model / Year */}
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="make" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Make</FormLabel>
                    <FormControl><Input placeholder="Freightliner" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="model" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormControl><Input placeholder="Cascadia" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="year" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Year</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="2022"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Row 3: Plate + State */}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="licensePlate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>License Plate</FormLabel>
                    <FormControl><Input placeholder="ABC-1234" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="state" render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select state…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {US_STATES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Row 4: Carrier + Dispatcher */}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="carrierId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Carrier</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : "none"}
                      onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                    >
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select carrier…" /></SelectTrigger>
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
                )} />
                <FormField control={form.control} name="dispatcherId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dispatcher</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : "none"}
                      onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                    >
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select dispatcher…" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No dispatcher</SelectItem>
                        {dispatchers.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)}>
                            {d.firstName} {d.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Status */}
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="out-of-service">Out of Service</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Notes */}
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Optional notes…" rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editing ? "Save Changes" : "Add Truck"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
