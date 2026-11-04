import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRiskToast as useToast } from "@/components/risk/risk-controls";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow, format, differenceInDays } from "date-fns";
import { PageInsights } from "@/components/PageInsights";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { CardContent } from "@/components/ui/card";
import { RiskCard as Card, RiskButton as Button, RiskInput as Input, RiskDialogContent as DialogContent, RiskSelectContent as SelectContent, RiskSelectTrigger as SelectTrigger, RiskStatCard, RiskBadge, RiskTable } from "@/components/risk/risk-controls";
import { NeuPageShell } from "@/styles/neu/components";
import { NeuNotice } from "@/components/shared/NeuNotice";
import "@/components/risk/risk-neu.css";
import { NeuTextarea as Textarea } from "@/styles/neu";
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
import { cn } from "@/lib/utils";
import {
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  Clock,
  DollarSign,
  BarChart3,
  Search,
  Trash2,
  Filter,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type HeldInvoice = {
  id: number;
  invoiceNumber: string;
  amount: string;
  status: string;
  heldReason: string | null;
  heldFor?: string[];
  heldAt: string | null;
  heldBy: string | null;
  heldNotes: string | null;
  clientName?: string;
  brokerName?: string;
  loadNumber?: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(amount: string | number) {
  return `$${parseFloat(String(amount)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysOnHold(heldAt: string | null): number {
  if (!heldAt) return 0;
  return differenceInDays(new Date(), new Date(heldAt));
}

function DaysBadge({ days }: { days: number }) {
  const color =
    days <= 3 ? "ff-badge-funded" :
    days <= 7 ? "ff-badge-pending" :
                "ff-badge-rejected";
  return (
    <RiskBadge className={cn("ff-badge gap-1", color)}>
      <Clock className="h-2.5 w-2.5" /> {days}d
    </RiskBadge>
  );
}

const HOLD_REASONS = [
  "Missing documents",
  "Disputed freight charges",
  "FMCSA verification failure",
  "Duplicate invoice",
  "Carrier setup incomplete",
  "Credit limit exceeded",
  "Manual hold",
  "Other",
];

// ─── Release Dialog ───────────────────────────────────────────────────────────

function ReleaseDialog({
  invoice,
  onClose,
}: {
  invoice: HeldInvoice;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");

  const release = useMutation({
    mutationFn: () => apiRequest("POST", `/api/invoices/${invoice.id}/release`, { releaseNote: note }),
    onSuccess: () => {
      toast({ title: "Invoice released", description: `#${invoice.invoiceNumber} returned to queue.` });
      queryClient.invalidateQueries({ queryKey: ["/api/held"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      onClose();
    },
    onError: () => toast({ title: "Failed to release invoice", variant: "destructive" }),
  });

  const days = daysOnHold(invoice.heldAt);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="ff-held-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-4 w-4 text-emerald-500" />
            Release Invoice
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="ff-held-surface bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Invoice</span>
              <span className="font-mono font-semibold">{invoice.invoiceNumber}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Amount</span>
              <span className="font-semibold text-emerald-600">{fmt(invoice.amount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Hold reason</span>
              <span className="font-medium text-amber-600 dark:text-amber-400">{invoice.heldReason ?? "—"}</span>
            </div>
            {!!invoice.heldFor?.length && <div className="flex items-center justify-between">
              <span className="text-slate-500">Held for</span>
              <span className="capitalize">{invoice.heldFor.join(", ")}</span>
            </div>}
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Days on hold</span>
              <DaysBadge days={days} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Release note (optional)</label>
            <Textarea
              rows={3}
              placeholder="Describe why the hold is being lifted…"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={release.isPending}
            onClick={() => release.mutate()}
          >
            <PlayCircle className="h-3.5 w-3.5" />
            {release.isPending ? "Releasing…" : "Release Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HeldQueue() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canRelease = user?.role === "manager" || user?.role === "admin";
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [releaseTarget, setReleaseTarget] = useState<HeldInvoice | null>(null);

  const { data: held = [], isLoading } = useQuery<HeldInvoice[]>({
    queryKey: ["/api/held"],
    staleTime: 0,
    refetchOnMount: "always",
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalDollar = held.reduce((s, inv) => s + parseFloat(inv.amount), 0);
  const avgDays = held.length
    ? held.reduce((s, inv) => s + daysOnHold(inv.heldAt), 0) / held.length
    : 0;
  const reasonCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const inv of held) {
      const r = inv.heldReason ?? "Unknown";
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts;
  }, [held]);

  // ── Filters ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = held;
    if (reasonFilter !== "all") list = list.filter(i => i.heldReason === reasonFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.invoiceNumber.toLowerCase().includes(q) ||
        i.clientName?.toLowerCase().includes(q) ||
        i.brokerName?.toLowerCase().includes(q) ||
        i.heldReason?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [held, reasonFilter, search]);

  const uniqueReasons = Array.from(new Set(held.map(i => i.heldReason).filter(Boolean)));

  return (
    <div className="risk-neu-page ff-held-page flex h-screen bg-[#d4d0c8]">
      <Sidebar />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
        <TopNav title="Held Queue" subtitle="Invoices blocked from funding" neu />
        <NeuPageShell className="!min-h-0 flex-1 overflow-auto p-6">
          <PageInsights entity="held" title="Held queue" />
          <div className="max-w-7xl mx-auto space-y-5">

            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                  <PauseCircle className="h-6 w-6 text-amber-500" />
                  Held Queue
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Invoices blocked from funding — review and release when resolved
                </p>
              </div>
            </div>

            {/* Summary bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: "Invoices on Hold",     value: String(held.length),      icon: PauseCircle,  color: "text-amber-600 dark:text-amber-400",    bg: "bg-amber-50 dark:bg-amber-950/20"    },
                { label: "Total Amount Held",     value: fmt(totalDollar),          icon: DollarSign,   color: "text-red-600 dark:text-red-400",        bg: "bg-red-50 dark:bg-red-950/20"        },
                { label: "Avg Days on Hold",      value: `${avgDays.toFixed(1)}d`,  icon: BarChart3,    color: "text-slate-600 dark:text-slate-400",    bg: "bg-slate-100 dark:bg-slate-800"      },
              ].map(s => (
                <RiskStatCard key={s.label} label={s.label} value={s.value} icon={<s.icon className={cn("h-5 w-5", s.color)} />} className="min-h-32 p-4" />
              ))}
            </div>

            {/* Alert banner if old items */}
            {held.some(i => daysOnHold(i.heldAt) > 7) && (
              <NeuNotice severity="block" className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span><strong>{held.filter(i => daysOnHold(i.heldAt) > 7).length}</strong> invoice(s) have been held for <strong>8+ days</strong> — immediate review required.</span>
              </NeuNotice>
            )}

            {/* Filters */}
            <Card className="ff-card ff-held-surface flex flex-wrap items-center gap-2 p-3">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search invoice, carrier, broker…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Select value={reasonFilter} onValueChange={setReasonFilter}>
                <SelectTrigger className="h-9 text-sm w-48 gap-1">
                  <Filter className="h-3.5 w-3.5 text-slate-400" />
                  <SelectValue placeholder="All reasons" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  {uniqueReasons.map(r => (
                    <SelectItem key={r!} value={r!}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Card>

            {/* Table */}
            <Card className="ff-table-container ff-held-surface border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <RiskTable className="ff-data-table w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                      {["Invoice #", "Carrier", "Broker", "Amount", "Hold Reason", "Held Date", "Held By", "Days on Hold", "Action"].map(h => (
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
                          {Array.from({ length: 9 }).map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-16 text-center">
                          <PauseCircle className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                          <p className="text-sm text-slate-400">
                            {held.length === 0 ? "No invoices currently on hold." : "No invoices match your filters."}
                          </p>
                        </td>
                      </tr>
                    ) : filtered.map(inv => {
                      const days = daysOnHold(inv.heldAt);
                      return (
                        <tr
                          key={inv.id}
                          className="transition-colors"
                        >
                          <td className="px-4 py-3">
                            <span className="font-mono font-semibold text-[12px] text-slate-800 dark:text-white">{inv.invoiceNumber}</span>
                            {inv.loadNumber && <p className="text-[10px] text-slate-400">Load {inv.loadNumber}</p>}
                          </td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                            {inv.clientName ?? <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                            {inv.brokerName ?? <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3 font-bold tabular-nums text-slate-800 dark:text-white whitespace-nowrap">
                            {fmt(inv.amount)}
                          </td>
                          <td className="px-4 py-3">
                            <RiskBadge className="ff-badge ff-badge-hold gap-1">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {inv.heldReason ?? "Unspecified"}
                            </RiskBadge>
                            {!!inv.heldFor?.length && <p className="mt-1 text-xs capitalize">Held for: {inv.heldFor.join(", ")}</p>}
                            {inv.heldNotes && (
                              <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[160px]">{inv.heldNotes}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap text-[12px]">
                            {inv.heldAt ? format(new Date(inv.heldAt), "MMM d, yyyy") : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-[12px]">
                            {inv.heldBy ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            <DaysBadge days={days} />
                          </td>
                          <td className="px-4 py-3">
                            <Button
                              size="sm"
                              disabled={!canRelease}
                              className="h-7 text-[11px] gap-1"
                              onClick={() => setReleaseTarget(inv)}
                            >
                              <PlayCircle className="h-3 w-3" /> Release
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </RiskTable>
              </div>
            </Card>
          </div>
        </NeuPageShell>
      </div>

      {releaseTarget && (
        <ReleaseDialog invoice={releaseTarget} onClose={() => setReleaseTarget(null)} />
      )}
    </div>
  );
}
