import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { FundingButton as Button, FundingCard as Card, FundingInput as Input, FundingDialogContent as DialogContent, FundingSelectTrigger as SelectTrigger, FundingSelectContent as SelectContent } from "@/components/funding/funding-controls";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { cn } from "@/lib/utils";
import {
  Plus,
  Search,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  Inbox,
  Banknote,
  Clock,
  Trash2,
  Link2,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import "@/components/funding/funding-neu.css";
import { FundingStatCard } from "@/components/funding/funding-stat-card";
import { NeuPageShell, NeuTable } from "@/styles/neu/components";
import { FundingBadge } from "@/components/funding/funding-badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type LockboxEntry = {
  id: number;
  receivedDate: string;
  amount: string;
  payorName: string;
  payorReference: string | null;
  bankReference: string | null;
  status: "unmatched" | "matched" | "partial" | "exception";
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
};

type Invoice = {
  id: number;
  invoiceNumber: string;
  amount: string;
  status: string;
  clientId: number;
  loadNumber: string | null;
};

type MatchLine = {
  invoiceId: number;
  invoiceNumber: string;
  invoiceAmount: number;
  appliedAmount: number;
  varianceType: "full_match" | "short_pay" | "overpay" | "write_off";
  varianceReason?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  unmatched:  { label: "Unmatched",  bg: "bg-amber-50  dark:bg-amber-950/20",  border: "border-amber-200 dark:border-amber-800",  text: "text-amber-700 dark:text-amber-400",  dot: "bg-amber-400"  },
  matched:    { label: "Matched",    bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-400" },
  partial:    { label: "Partial",    bg: "bg-blue-50   dark:bg-blue-950/20",   border: "border-blue-200  dark:border-blue-800",   text: "text-blue-700   dark:text-blue-400",   dot: "bg-blue-400"   },
  exception:  { label: "Exception",  bg: "bg-red-50    dark:bg-red-950/20",    border: "border-red-200   dark:border-red-800",    text: "text-red-700    dark:text-red-400",    dot: "bg-red-400"    },
} as const;

const OPEN_STATUSES = ["submitted", "docs_pending", "under_review", "approved", "funded"];

// ─── Schemas ─────────────────────────────────────────────────────────────────

const newEntrySchema = z.object({
  receivedDate: z.string().min(1, "Required"),
  amount: z.string().min(1, "Required"),
  payorName: z.string().min(1, "Required"),
  payorReference: z.string().optional(),
  bankReference: z.string().optional(),
  notes: z.string().optional(),
});

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: LockboxEntry["status"] }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <FundingBadge
      tone={status === "matched" ? "success" : status === "unmatched" || status === "exception" ? "warning" : "accent"}
      className={cn("inline-flex items-center gap-1 border px-2 py-0.5 text-[10.5px] font-semibold", cfg.bg, cfg.border, cfg.text)}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </FundingBadge>
  );
}

function fmt(amount: string | number) {
  return `$${parseFloat(String(amount)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Match Modal ──────────────────────────────────────────────────────────────

function MatchModal({
  entry,
  onClose,
  onMatched,
}: {
  entry: LockboxEntry;
  onClose: () => void;
  onMatched: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedLines, setSelectedLines] = useState<MatchLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("ach");
  const [expandedInvoice, setExpandedInvoice] = useState<number | null>(null);
  const [applyAmounts, setApplyAmounts] = useState<Record<number, string>>({});

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", { all: true }],
  });

  const openInvoices = useMemo(() =>
    invoices.filter(inv => OPEN_STATUSES.includes(inv.status)),
    [invoices],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return openInvoices;
    const q = search.toLowerCase();
    return openInvoices.filter(inv =>
      inv.invoiceNumber.toLowerCase().includes(q) ||
      inv.loadNumber?.toLowerCase().includes(q),
    );
  }, [openInvoices, search]);

  const totalApplied = selectedLines.reduce((s, l) => s + l.appliedAmount, 0);
  const entryAmount = parseFloat(entry.amount);
  const remaining = entryAmount - totalApplied;

  const matchMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/lockbox/${entry.id}/match`, { matches: selectedLines, paymentMethod }),
    onSuccess: () => {
      toast({ title: "Entry matched", description: `${selectedLines.length} invoice(s) applied successfully.` });
      onMatched();
      onClose();
    },
    onError: (e: any) => toast({ title: "Match failed", description: e.message, variant: "destructive" }),
  });

  function addLine(inv: Invoice) {
    if (selectedLines.find(l => l.invoiceId === inv.id)) return;
    const invAmt = parseFloat(inv.amount);
    const apply = Math.min(invAmt, remaining > 0 ? remaining : invAmt);
    const varianceType = Math.abs(invAmt - apply) < 0.01 ? "full_match" : apply < invAmt ? "short_pay" : "overpay";
    setSelectedLines(prev => [...prev, {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceAmount: invAmt,
      appliedAmount: apply,
      varianceType,
    }]);
    setApplyAmounts(prev => ({ ...prev, [inv.id]: String(apply) }));
  }

  function removeLine(invoiceId: number) {
    setSelectedLines(prev => prev.filter(l => l.invoiceId !== invoiceId));
    setApplyAmounts(prev => { const n = { ...prev }; delete n[invoiceId]; return n; });
  }

  function updateApply(invoiceId: number, val: string, invAmt: number) {
    setApplyAmounts(prev => ({ ...prev, [invoiceId]: val }));
    const apply = parseFloat(val) || 0;
    const varianceType = Math.abs(invAmt - apply) < 0.01 ? "full_match" : apply < invAmt ? "short_pay" : "overpay";
    setSelectedLines(prev => prev.map(l => l.invoiceId === invoiceId ? { ...l, appliedAmount: apply, varianceType } : l));
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="funding-neu-dialog max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-blue-500" />
            Match Lockbox Entry — {entry.payorName}
          </DialogTitle>
        </DialogHeader>

        {/* Entry summary */}
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm flex flex-wrap gap-4">
          <div><span className="text-slate-500 dark:text-slate-400">Received:</span> <strong>{format(new Date(entry.receivedDate), "MMM d, yyyy")}</strong></div>
          <div><span className="text-slate-500 dark:text-slate-400">Total:</span> <strong className="text-emerald-600">{fmt(entry.amount)}</strong></div>
          <div><span className="text-slate-500 dark:text-slate-400">Applied:</span> <strong className="text-blue-600">{fmt(totalApplied)}</strong></div>
          <div><span className="text-slate-500 dark:text-slate-400">Remaining:</span> <strong className={remaining < -0.01 ? "text-red-600" : remaining > 0.01 ? "text-amber-600" : "text-emerald-600"}>{fmt(remaining)}</strong></div>
        </div>

        {/* Selected lines */}
        {selectedLines.length > 0 && (
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">Selected ({selectedLines.length})</p>
            {selectedLines.map(line => (
              <div key={line.invoiceId} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-[12px] text-slate-700 dark:text-slate-300 w-28 shrink-0">{line.invoiceNumber}</span>
                <span className="text-slate-500 dark:text-slate-400 text-[11px] shrink-0">{fmt(line.invoiceAmount)}</span>
                <span className="text-[11px] text-slate-400 shrink-0">→</span>
                <Input
                  type="number"
                  step="0.01"
                  value={applyAmounts[line.invoiceId] ?? ""}
                  onChange={e => updateApply(line.invoiceId, e.target.value, line.invoiceAmount)}
                  className="h-6 w-24 text-[12px] px-2 py-0"
                />
                <span className={cn("text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded",
                  line.varianceType === "full_match" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" :
                  line.varianceType === "short_pay"  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400" :
                  "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400"
                )}>{line.varianceType.replace("_", " ")}</span>
                <button onClick={() => removeLine(line.invoiceId)} className="ml-auto text-slate-400 hover:text-red-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Invoice search */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Search open invoices by number or load…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        {/* Invoice list */}
        <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
          {isLoading ? (
            <p className="text-center text-sm text-slate-400 py-8">Loading invoices…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-8">No open invoices found.</p>
          ) : filtered.map(inv => {
            const already = selectedLines.find(l => l.invoiceId === inv.id);
            return (
              <div
                key={inv.id}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors",
                  already
                    ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/20"
                    : "border-slate-200 hover:border-blue-200 hover:bg-blue-50/50 dark:border-slate-700 dark:hover:bg-slate-800",
                )}
                onClick={() => already ? removeLine(inv.id) : addLine(inv)}
              >
                <div className="flex items-center gap-3">
                  {already
                    ? <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
                    : <div className="h-4 w-4 rounded-full border-2 border-slate-300 shrink-0" />
                  }
                  <div>
                    <p className="font-mono font-semibold text-[12px]">{inv.invoiceNumber}</p>
                    {inv.loadNumber && <p className="text-[10px] text-slate-400">Load {inv.loadNumber}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmt(inv.amount)}</span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border",
                    inv.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400" :
                    "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                  )}>{inv.status}</span>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="flex items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 mr-auto">
            <Label className="text-xs text-slate-500">Payment method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ach">ACH</SelectItem>
                <SelectItem value="wire">Wire</SelectItem>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={selectedLines.length === 0 || matchMutation.isPending}
            onClick={() => matchMutation.mutate()}
            className="gap-1.5"
          >
            <Link2 className="h-3.5 w-3.5" />
            {matchMutation.isPending ? "Matching…" : `Confirm Match (${selectedLines.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── New Entry Form ───────────────────────────────────────────────────────────

function NewEntryDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const form = useForm({ resolver: zodResolver(newEntrySchema), defaultValues: {
    receivedDate: format(new Date(), "yyyy-MM-dd"),
    amount: "",
    payorName: "",
    payorReference: "",
    bankReference: "",
    notes: "",
  }});

  const create = useMutation({
    mutationFn: (vals: z.infer<typeof newEntrySchema>) => apiRequest("POST", "/api/lockbox", {
      ...vals,
      receivedDate: new Date(vals.receivedDate).toISOString(),
    }),
    onSuccess: () => { toast({ title: "Entry created" }); onCreated(); onClose(); },
    onError: () => toast({ title: "Failed to create entry", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="funding-neu-dialog sm:max-w-md">
        <DialogHeader><DialogTitle>New Lockbox Entry</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(v => create.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="receivedDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Received Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount ($)</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="payorName" render={({ field }) => (
              <FormItem>
                <FormLabel>Payor Name</FormLabel>
                <FormControl><Input placeholder="Broker or debtor name" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="payorReference" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payor Reference</FormLabel>
                  <FormControl><Input placeholder="Remittance ref" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="bankReference" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank Reference</FormLabel>
                  <FormControl><Input placeholder="Bank trace / ACH id" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Optional notes" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button type="submit" size="sm" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create Entry"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Lockbox() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [matchEntry, setMatchEntry] = useState<LockboxEntry | null>(null);
  const [flagEntry, setFlagEntry] = useState<LockboxEntry | null>(null);
  const [flagNotes, setFlagNotes] = useState("");

  const { data: entries = [], isLoading } = useQuery<LockboxEntry[]>({
    queryKey: ["/api/lockbox", statusFilter],
    queryFn: () => fetch(`/api/lockbox?status=${statusFilter}`).then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/lockbox/${id}`),
    onSuccess: () => { toast({ title: "Entry deleted" }); queryClient.invalidateQueries({ queryKey: ["/api/lockbox"] }); },
    onError: (e: any) => toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });

  const flagMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      apiRequest("PATCH", `/api/lockbox/${id}`, { status: "exception", notes }),
    onSuccess: () => {
      toast({ title: "Entry flagged as exception" });
      queryClient.invalidateQueries({ queryKey: ["/api/lockbox"] });
      setFlagEntry(null);
    },
    onError: () => toast({ title: "Failed to flag entry", variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    if (!searchText.trim()) return entries;
    const q = searchText.toLowerCase();
    return entries.filter(e =>
      e.payorName.toLowerCase().includes(q) ||
      e.bankReference?.toLowerCase().includes(q) ||
      e.payorReference?.toLowerCase().includes(q),
    );
  }, [entries, searchText]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const today = format(new Date(), "yyyy-MM-dd");
  const todayEntries = entries.filter(e => e.receivedDate.startsWith(today));
  const totalToday = todayEntries.reduce((s, e) => s + parseFloat(e.amount), 0);
  const totalUnmatched = entries.filter(e => e.status === "unmatched").reduce((s, e) => s + parseFloat(e.amount), 0);
  const totalMatched = entries.filter(e => e.status === "matched" || e.status === "partial").reduce((s, e) => s + parseFloat(e.amount), 0);
  const unmatchedCount = entries.filter(e => e.status === "unmatched").length;
  const exceptionCount = entries.filter(e => e.status === "exception").length;

  return (
    <div className="funding-neu-page flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Lockbox" subtitle="Match incoming payments to open invoices" neu />
        <NeuPageShell className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-5">

            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                  <Inbox className="h-6 w-6 text-blue-600" />
                  Lockbox
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Match incoming payments to open invoices
                </p>
              </div>
              <Button size="sm" onClick={() => setShowNew(true)} className="gap-1.5">
                <Plus className="h-4 w-4" /> New Entry
              </Button>
            </div>

            {/* Summary bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Received Today",  value: fmt(totalToday),    icon: Banknote,      color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-950/20"    },
                { label: "Unmatched ($)",   value: fmt(totalUnmatched), icon: Clock,         color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-950/20"  },
                { label: "Matched ($)",     value: fmt(totalMatched),   icon: CheckCircle2,  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/20" },
                { label: "Exceptions",      value: String(exceptionCount), icon: AlertTriangle, color: "text-red-600 dark:text-red-400",     bg: "bg-red-50 dark:bg-red-950/20"    },
              ].map(s => (
                <FundingStatCard
                  key={s.label}
                  label={s.label}
                  value={s.value}
                  icon={<s.icon className="h-4 w-4" />}
                  className="min-h-32 p-4"
                />
              ))}
            </div>

            {/* Unmatched alert banner */}
            {unmatchedCount > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span><strong>{unmatchedCount}</strong> unmatched {unmatchedCount === 1 ? "entry requires" : "entries require"} attention — click <strong>Match</strong> to apply to open invoices.</span>
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search payor, bank ref…"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <div className="flex gap-1">
                {(["all", "unmatched", "partial", "matched", "exception"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] font-semibold border transition-colors capitalize",
                      statusFilter === s
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-blue-300",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Table */}
            <Card className="border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <NeuTable className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                      {["Received Date", "Payor", "Amount", "Bank Reference", "Payor Reference", "Status", "Actions"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {isLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          {Array.from({ length: 7 }).map((_, j) => (
                            <td key={j} className="px-4 py-3"><div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" /></td>
                          ))}
                        </tr>
                      ))
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-16 text-center">
                          <ArrowRightLeft className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                          <p className="text-sm text-slate-400">No lockbox entries found.</p>
                          <Button size="sm" variant="outline" className="mt-3 gap-1" onClick={() => setShowNew(true)}>
                            <Plus className="h-3.5 w-3.5" /> Add First Entry
                          </Button>
                        </td>
                      </tr>
                    ) : filtered.map(entry => (
                      <tr
                        key={entry.id}
                        className={cn(
                          "transition-colors",
                          entry.status === "unmatched"
                            ? "bg-amber-50/60 dark:bg-amber-950/10 hover:bg-amber-100/60 dark:hover:bg-amber-950/20"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/40",
                        )}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300 font-medium">
                          {format(new Date(entry.receivedDate), "MMM d, yyyy")}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-800 dark:text-white">{entry.payorName}</p>
                          {entry.notes && <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[180px]">{entry.notes}</p>}
                        </td>
                        <td className="px-4 py-3 font-bold tabular-nums text-slate-800 dark:text-white whitespace-nowrap">
                          {fmt(entry.amount)}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-slate-500 dark:text-slate-400">
                          {entry.bankReference ?? <span className="text-slate-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-slate-500 dark:text-slate-400">
                          {entry.payorReference ?? <span className="text-slate-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={entry.status} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {(entry.status === "unmatched" || entry.status === "partial") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] gap-1 border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/20"
                                onClick={() => setMatchEntry(entry)}
                              >
                                <Link2 className="h-3 w-3" /> Match
                              </Button>
                            )}
                            {entry.status === "unmatched" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[11px] gap-1 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20"
                                onClick={() => { setFlagEntry(entry); setFlagNotes(entry.notes ?? ""); }}
                              >
                                <AlertTriangle className="h-3 w-3" /> Flag
                              </Button>
                            )}
                            {entry.status === "unmatched" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                                onClick={() => {
                                  if (confirm(`Delete lockbox entry from ${entry.payorName}?`)) {
                                    deleteMutation.mutate(entry.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </NeuTable>
              </div>
            </Card>
          </div>
        </NeuPageShell>
      </div>

      {/* Modals */}
      {showNew && (
        <NewEntryDialog
          onClose={() => setShowNew(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["/api/lockbox"] })}
        />
      )}
      {matchEntry && (
        <MatchModal
          entry={matchEntry}
          onClose={() => setMatchEntry(null)}
          onMatched={() => queryClient.invalidateQueries({ queryKey: ["/api/lockbox"] })}
        />
      )}

      {/* Flag as exception dialog */}
      {flagEntry && (
        <Dialog open onOpenChange={() => setFlagEntry(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Flag as Exception</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              This will mark the entry from <strong>{flagEntry.payorName}</strong> ({fmt(flagEntry.amount)}) as an exception for manual review.
            </p>
            <div>
              <Label className="text-xs">Reason / Notes</Label>
              <Textarea
                rows={3}
                value={flagNotes}
                onChange={e => setFlagNotes(e.target.value)}
                placeholder="Describe why this cannot be matched…"
                className="mt-1 text-sm"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setFlagEntry(null)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-white gap-1"
                disabled={flagMutation.isPending}
                onClick={() => flagMutation.mutate({ id: flagEntry.id, notes: flagNotes })}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {flagMutation.isPending ? "Flagging…" : "Flag Entry"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
