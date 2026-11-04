import { useState } from "react";
import { PageInsights } from "@/components/PageInsights";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { CardContent } from "@/components/ui/card";
import { NeuTextarea as Textarea } from "@/styles/neu";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectItem, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, MoreHorizontal, MailOpen, Send, Eye, CheckCheck } from "lucide-react";
import {
  OperationsBadge,
  OperationsButton as Button,
  OperationsCard as Card,
  OperationsDialogContent as DialogContent,
  OperationsDropdownMenuContent as DropdownMenuContent,
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

interface ReleaseLetter {
  id: number;
  invoiceId: number | null;
  carrierId: number;
  brokerId: number | null;
  letterType: "standard" | "conditional" | "final";
  status: "draft" | "sent" | "acknowledged";
  sentAt: string | null;
  acknowledgedAt: string | null;
  content: string;
  createdAt: string;
}

interface Client { id: number; name: string; }
interface Broker { id: number; name: string; email: string; contactPerson: string; }
interface Invoice { id: number; invoiceNumber: string; clientId: number; amount: string; loadNumber: string | null; }

// ─── Form Schema ──────────────────────────────────────────────────────────────

const generateSchema = z.object({
  carrierId: z.string().min(1, "Carrier required"),
  brokerId: z.string().optional(),
  invoiceId: z.string().optional(),
  letterType: z.enum(["standard", "conditional", "final"]),
  content: z.string().min(10, "Letter content required"),
});

type GenerateForm = z.infer<typeof generateSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const fmt = (n: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

const TYPE_STYLES: Record<string, string> = {
  standard:    "ff-badge-submitted",
  conditional: "ff-badge-pending",
  final:       "ff-badge-hold",
};

const STATUS_STYLES: Record<string, string> = {
  draft:        "ff-badge-draft",
  sent:         "ff-badge-approved",
  acknowledged: "ff-badge-funded",
};

function Chip({ label, cls }: { label: string; cls: string }) {
  return <OperationsBadge className={`ff-badge ${cls}`}>{label}</OperationsBadge>;
}

function buildTemplate(
  letterType: string,
  carrier: Client | undefined,
  broker: Broker | undefined,
  invoice: Invoice | undefined,
) {
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const brokerLine = broker ? `${broker.name}\n${broker.contactPerson}` : "[Broker Name]";
  const carrierName = carrier?.name ?? "[Carrier Name]";
  const invLine = invoice ? `Invoice #${invoice.invoiceNumber}${invoice.loadNumber ? ` / Load #${invoice.loadNumber}` : ""} — ${fmt(invoice.amount)}` : "[Invoice Details]";

  if (letterType === "final") {
    return `${date}

To: ${brokerLine}

RE: FINAL RELEASE OF LIEN

This letter serves as final notice that ${carrierName} has assigned all receivables for the following freight bill to Trucking Pros Financial (TPF):

${invLine}

TPF holds a valid first-priority security interest in these receivables. All payments must be remitted directly to TPF. Failure to do so may result in double liability.

Please direct all payments to:
  Trucking Pros Financial
  ACH / Check remittance details on file

If you have any questions, contact us at collections@tpffinancial.com.

Sincerely,
Trucking Pros Financial`;
  }

  if (letterType === "conditional") {
    return `${date}

To: ${brokerLine}

RE: CONDITIONAL RELEASE OF LIEN

This letter provides conditional release of any lien or claim held by Trucking Pros Financial (TPF) on behalf of ${carrierName} for the following:

${invLine}

This release is conditioned upon receipt and clearance of payment in full. Until payment clears, TPF retains all rights to collect on the assigned receivable.

Sincerely,
Trucking Pros Financial`;
  }

  // standard
  return `${date}

To: ${brokerLine}

RE: NOTICE OF ASSIGNMENT / RELEASE LETTER

Please be advised that ${carrierName} has factored the following invoice through Trucking Pros Financial (TPF):

${invLine}

Pursuant to this assignment, you are hereby notified that all payments for the above invoice must be made payable to and remitted directly to Trucking Pros Financial. Any payments made to ${carrierName} will not discharge your obligation.

Please confirm receipt of this notice by signing and returning a copy.

Sincerely,
Trucking Pros Financial`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReleaseLetters() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewLetter, setPreviewLetter] = useState<ReleaseLetter | null>(null);
  const [sendDialogId, setSendDialogId] = useState<number | null>(null);
  const [sendEmail, setSendEmailState] = useState("");

  const [carrierFilter, setCarrierFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const form = useForm<GenerateForm>({
    resolver: zodResolver(generateSchema),
    defaultValues: { carrierId: "", brokerId: "", invoiceId: "", letterType: "standard", content: "" },
  });

  const watchCarrier = form.watch("carrierId");
  const watchBroker = form.watch("brokerId");
  const watchInvoice = form.watch("invoiceId");
  const watchType = form.watch("letterType");

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: letters = [], isLoading } = useQuery<ReleaseLetter[]>({ queryKey: ["/api/release-letters"] });
  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ["/api/clients", { all: true }] });
  const { data: brokersData = [] } = useQuery<Broker[]>({ queryKey: ["/api/brokers", { all: true }] });
  const { data: invoicesData = [] } = useQuery<Invoice[]>({ queryKey: ["/api/invoices", { all: true }] });

  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c.name]));
  const brokerMap = Object.fromEntries(brokersData.map((b) => [b.id, b.name]));

  // Filter invoices to selected carrier
  const carrierInvoices = watchCarrier
    ? invoicesData.filter((inv) => String(inv.clientId) === watchCarrier)
    : invoicesData;

  // Auto-populate content when key fields change
  function autoPopulate(type?: string, carrierId?: string, brokerId?: string, invoiceId?: string) {
    const t = type ?? watchType;
    const c = clients.find((x) => String(x.id) === (carrierId ?? watchCarrier));
    const b = brokersData.find((x) => String(x.id) === (brokerId ?? watchBroker));
    const inv = invoicesData.find((x) => String(x.id) === (invoiceId ?? watchInvoice));
    form.setValue("content", buildTemplate(t, c, b, inv));
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/release-letters", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/release-letters"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Release letter created" });
    },
    onError: (e: any) => {
      // apiRequest throws Error with message like "400: {\"message\":\"...\"}"
      let msg = "Failed to create letter";
      try {
        const raw = e?.message ?? "";
        const jsonPart = raw.replace(/^\d+:\s*/, "");
        const parsed = JSON.parse(jsonPart);
        if (parsed?.message) msg = parsed.message;
      } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/release-letters/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/release-letters"] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: ({ id, email }: { id: number; email: string }) =>
      apiRequest("POST", `/api/release-letters/${id}/send`, { email: email || undefined }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/release-letters"] });
      setSendDialogId(null);
      setSendEmailState("");
      toast({ title: "Letter sent via email" });
    },
    onError: async (e: any) => {
      let msg = "Failed to send letter";
      try { const j = await e?.response?.json?.(); if (j?.message) msg = j.message; } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function openGenerate() {
    form.reset({ carrierId: "", brokerId: "", invoiceId: "", letterType: "standard", content: "" });
    setDialogOpen(true);
  }

  function onSubmit(data: GenerateForm) {
    createMutation.mutate({
      carrierId: data.carrierId,
      brokerId: data.brokerId || undefined,
      invoiceId: data.invoiceId || undefined,
      letterType: data.letterType,
      content: data.content,
    });
  }

  function openSend(letter: ReleaseLetter) {
    // Pre-fill broker email if known
    const broker = brokersData.find((b) => b.id === letter.brokerId);
    setSendEmailState(broker?.email ?? "");
    setSendDialogId(letter.id);
  }

  // ─── Filtering ─────────────────────────────────────────────────────────────

  const filtered = letters.filter((l) => {
    const matchCarrier = carrierFilter === "all" || String(l.carrierId) === carrierFilter;
    const matchBroker = brokerFilter === "all" || String(l.brokerId) === brokerFilter;
    const matchStatus = statusFilter === "all" || l.status === statusFilter;
    return matchCarrier && matchBroker && matchStatus;
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="operations-neu-page ff-release-letters-page flex min-h-[100dvh] overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopNav title="Release Letters" neu />
        <NeuPageShell className="!min-h-0 flex-1 overflow-y-auto p-6 space-y-6">
          <PageInsights entity="release-letters" title="Release letter activity" />

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <MailOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Release Letters</h1>
                <p className="text-sm text-muted-foreground">{filtered.length} letter{filtered.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            <Button variant="accent" onClick={openGenerate} className="gap-2">
              <Plus className="h-4 w-4" /> Generate Letter
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Filtered Letters", value: filtered.length },
              { label: "Sent Letters", value: letters.filter((letter) => letter.status === "sent").length },
              { label: "Acknowledged", value: letters.filter((letter) => letter.status === "acknowledged").length },
            ].map((stat) => (
              <NeuStatCard key={stat.label} label={stat.label} value={stat.value} icon={<MailOpen className="h-5 w-5" />} className="operations-neu-surface min-h-32 p-4" />
            ))}
          </div>

          {/* Filters */}
          <Card className="operations-neu-surface">
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3">
                <Select value={carrierFilter} onValueChange={setCarrierFilter}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Carriers" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Carriers</SelectItem>
                    {clients.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={brokerFilter} onValueChange={setBrokerFilter}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Brokers" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Brokers</SelectItem>
                    {brokersData.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="acknowledged">Acknowledged</SelectItem>
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
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Carrier</TableHead>
                    <TableHead>Broker</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Acknowledged</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No release letters found.</TableCell></TableRow>
                  ) : filtered.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium text-sm">
                        {l.invoiceId ? `#${l.invoiceId}` : "—"}
                      </TableCell>
                      <TableCell>{clientMap[l.carrierId] ?? `#${l.carrierId}`}</TableCell>
                      <TableCell>{l.brokerId ? (brokerMap[l.brokerId] ?? `#${l.brokerId}`) : "—"}</TableCell>
                      <TableCell><Chip label={l.letterType.charAt(0).toUpperCase() + l.letterType.slice(1)} cls={TYPE_STYLES[l.letterType]} /></TableCell>
                      <TableCell><Chip label={l.status.charAt(0).toUpperCase() + l.status.slice(1)} cls={STATUS_STYLES[l.status]} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(l.sentAt)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(l.acknowledgedAt)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(l.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" aria-label={`Actions for release letter ${l.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setPreviewLetter(l)} className="gap-2">
                              <Eye className="h-3.5 w-3.5" /> Preview
                            </DropdownMenuItem>
                            {l.status === "draft" && (
                              <DropdownMenuItem onClick={() => openSend(l)} className="gap-2">
                                <Send className="h-3.5 w-3.5" /> Send via Email
                              </DropdownMenuItem>
                            )}
                            {l.status === "sent" && (
                              <DropdownMenuItem onClick={() => statusMutation.mutate({ id: l.id, status: "acknowledged" })} className="gap-2">
                                <CheckCheck className="h-3.5 w-3.5" /> Mark Acknowledged
                              </DropdownMenuItem>
                            )}
                            {l.status === "draft" && (
                              <DropdownMenuItem onClick={() => openSend(l)} className="gap-2 text-blue-600">
                                <Send className="h-3.5 w-3.5" /> Send
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
        </NeuPageShell>
      </div>

      {/* Generate Letter Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="operations-neu-dialog max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Release Letter</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="carrierId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Carrier <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value} onValueChange={(v) => { field.onChange(v); autoPopulate(undefined, v, undefined, undefined); }}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select carrier…" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {clients.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="brokerId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Broker</FormLabel>
                    <Select value={field.value || "none"} onValueChange={(v) => { const val = v === "none" ? "" : v; field.onChange(val); autoPopulate(undefined, undefined, val, undefined); }}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select broker…" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {brokersData.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="invoiceId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice</FormLabel>
                    <Select value={field.value || "none"} onValueChange={(v) => { const val = v === "none" ? "" : v; field.onChange(val); autoPopulate(undefined, undefined, undefined, val); }}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select invoice…" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {carrierInvoices.map((inv) => (
                          <SelectItem key={inv.id} value={String(inv.id)}>
                            {inv.invoiceNumber}{inv.loadNumber ? ` / ${inv.loadNumber}` : ""} — {fmt(inv.amount)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="letterType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Letter Type <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value} onValueChange={(v) => { field.onChange(v); autoPopulate(v, undefined, undefined, undefined); }}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="conditional">Conditional</SelectItem>
                        <SelectItem value="final">Final</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => autoPopulate()}
                >
                  Auto-fill Template
                </Button>
              </div>

              <FormField control={form.control} name="content" render={({ field }) => (
                <FormItem>
                  <FormLabel>Letter Content <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Textarea
                      rows={14}
                      className="font-mono text-sm"
                      placeholder="Letter body will appear here…"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <Separator />
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating…" : "Save as Draft"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewLetter} onOpenChange={() => setPreviewLetter(null)}>
        <DialogContent className="operations-neu-dialog max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              Release Letter Preview
              {previewLetter && (
                <>
                  <Chip label={previewLetter.letterType.charAt(0).toUpperCase() + previewLetter.letterType.slice(1)} cls={TYPE_STYLES[previewLetter.letterType]} />
                  <Chip label={previewLetter.status.charAt(0).toUpperCase() + previewLetter.status.slice(1)} cls={STATUS_STYLES[previewLetter.status]} />
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {previewLetter && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-muted-foreground">Carrier</p><p className="font-medium">{clientMap[previewLetter.carrierId] ?? "—"}</p></div>
                <div><p className="text-muted-foreground">Broker</p><p className="font-medium">{previewLetter.brokerId ? (brokerMap[previewLetter.brokerId] ?? "—") : "—"}</p></div>
                <div><p className="text-muted-foreground">Invoice</p><p className="font-medium">{previewLetter.invoiceId ? `#${previewLetter.invoiceId}` : "—"}</p></div>
              </div>
              <Separator />
              <div className="ff-card ff-release-letters-surface bg-white p-4 whitespace-pre-wrap font-mono text-sm leading-relaxed">
                {previewLetter.content}
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setPreviewLetter(null)}>Close</Button>
                {previewLetter.status === "draft" && (
                  <Button className="gap-2" onClick={() => { openSend(previewLetter); setPreviewLetter(null); }}>
                    <Send className="h-4 w-4" /> Send
                  </Button>
                )}
                {previewLetter.status === "sent" && (
                  <Button variant="secondary" className="gap-2" onClick={() => {
                    statusMutation.mutate({ id: previewLetter.id, status: "acknowledged" });
                    setPreviewLetter(null);
                  }}>
                    <CheckCheck className="h-4 w-4" /> Mark Acknowledged
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Send Email Dialog */}
      <Dialog open={sendDialogId !== null} onOpenChange={() => { setSendDialogId(null); setSendEmailState(""); }}>
        <DialogContent className="operations-neu-dialog max-w-md">
          <DialogHeader>
            <DialogTitle>Send Release Letter</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will send the letter via Resend. Confirm the recipient email address below.
            </p>
            <div>
              <label className="text-sm font-medium">Recipient Email</label>
              <Input
                type="email"
                className="mt-1"
                placeholder="broker@example.com"
                value={sendEmail}
                onChange={(e) => setSendEmailState(e.target.value)}
              />
            </div>
            <Separator />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setSendDialogId(null); setSendEmailState(""); }}>Cancel</Button>
              <Button
                className="gap-2"
                disabled={sendMutation.isPending || !sendEmail}
                onClick={() => sendDialogId && sendMutation.mutate({ id: sendDialogId, email: sendEmail })}
              >
                <Send className="h-4 w-4" />
                {sendMutation.isPending ? "Sending…" : "Send Letter"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
