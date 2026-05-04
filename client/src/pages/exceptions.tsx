import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  AlertOctagon,
  Info,
  Flame,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  Eye,
  ShieldAlert,
  FileWarning,
  DollarSign,
  CopyX,
  Inbox,
  HelpCircle,
} from "lucide-react";

type Exception = {
  id: number;
  type: "short_pay" | "overpay" | "doc_missing" | "credit_limit_exceeded" | "duplicate_invoice" | "unapplied_payment" | "other";
  severity: "low" | "medium" | "high" | "critical";
  entityType: "invoice" | "payment" | "client" | "debtor" | "broker";
  entityId?: number | null;
  entityRef?: string | null;
  title: string;
  description?: string | null;
  status: "open" | "under_review" | "resolved" | "waived";
  assignedTo?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolution?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

const SEVERITY_CONFIG = {
  low: { label: "Low", icon: Info, color: "text-slate-600 dark:text-slate-400", bg: "bg-slate-100 dark:bg-slate-800", ring: "border-slate-200 dark:border-slate-700", dot: "bg-slate-400" },
  medium: { label: "Medium", icon: AlertTriangle, color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", ring: "border-amber-200 dark:border-amber-900/50", dot: "bg-amber-500" },
  high: { label: "High", icon: AlertOctagon, color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/30", ring: "border-orange-200 dark:border-orange-900/50", dot: "bg-orange-500" },
  critical: { label: "Critical", icon: Flame, color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", ring: "border-red-200 dark:border-red-900/50", dot: "bg-red-600" },
};

const STATUS_CONFIG = {
  open: { label: "Open", color: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  under_review: { label: "Under Review", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  resolved: { label: "Resolved", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  waived: { label: "Waived", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
};

const TYPE_META: Record<Exception["type"], { label: string; icon: React.ElementType }> = {
  short_pay: { label: "Short Pay", icon: DollarSign },
  overpay: { label: "Overpay", icon: DollarSign },
  doc_missing: { label: "Doc Missing", icon: FileWarning },
  credit_limit_exceeded: { label: "Credit Limit", icon: ShieldAlert },
  duplicate_invoice: { label: "Duplicate Invoice", icon: CopyX },
  unapplied_payment: { label: "Unapplied Payment", icon: Inbox },
  other: { label: "Other", icon: HelpCircle },
};

const STATUS_TABS = ["all", "open", "under_review", "resolved", "waived"] as const;

export default function Exceptions() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<Exception | null>(null);
  const [resolution, setResolution] = useState("");
  const [form, setForm] = useState({
    type: "short_pay" as Exception["type"],
    severity: "medium" as Exception["severity"],
    entityType: "invoice" as Exception["entityType"],
    entityRef: "",
    title: "",
    description: "",
  });

  const { data: exceptions = [], isLoading } = useQuery<Exception[]>({ queryKey: ["/api/exceptions"] });

  const createMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/exceptions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exceptions"] });
      setShowCreate(false);
      setForm({ type: "short_pay", severity: "medium", entityType: "invoice", entityRef: "", title: "", description: "" });
      toast({ title: "Exception created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: number; [k: string]: unknown }) => {
      const { id, ...data } = payload;
      return apiRequest("PATCH", `/api/exceptions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exceptions"] });
      setResolveTarget(null);
      setResolution("");
      toast({ title: "Exception updated" });
    },
  });

  const filtered = exceptions.filter(e => {
    if (activeTab !== "all" && e.status !== activeTab) return false;
    if (filterSeverity !== "all" && e.severity !== filterSeverity) return false;
    if (search && !e.title.toLowerCase().includes(search.toLowerCase()) && !(e.entityRef?.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  const stats = {
    open: exceptions.filter(e => e.status === "open").length,
    critical: exceptions.filter(e => e.severity === "critical").length,
    high: exceptions.filter(e => e.severity === "high").length,
    under_review: exceptions.filter(e => e.status === "under_review").length,
    resolved: exceptions.filter(e => e.status === "resolved").length,
  };

  const tabCounts = STATUS_TABS.reduce((acc, t) => {
    acc[t] = t === "all" ? exceptions.length : exceptions.filter(e => e.status === t).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.06),_transparent_30%),linear-gradient(to_bottom,_#f8fafc,_#f1f5f9)] dark:bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Exception Management" subtitle="Track and resolve short-pays, overpays, missing docs, and other workflow exceptions" />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8 space-y-6">

            {/* Stats Row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {[
                { label: "Open", value: stats.open, accent: stats.open > 0 ? "text-red-600 dark:text-red-400" : "" },
                { label: "Critical", value: stats.critical, accent: stats.critical > 0 ? "text-red-600 dark:text-red-400" : "" },
                { label: "High Severity", value: stats.high, accent: stats.high > 0 ? "text-orange-600 dark:text-orange-400" : "" },
                { label: "Under Review", value: stats.under_review, accent: "text-amber-600 dark:text-amber-400" },
                { label: "Resolved", value: stats.resolved, accent: "text-emerald-600 dark:text-emerald-400" },
              ].map(s => (
                <Card key={s.label} className="rounded-2xl border border-slate-200/80 bg-white/85 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{s.label}</p>
                    <p className={cn("mt-1 text-2xl font-bold", s.accent || "text-slate-900 dark:text-white")}>{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Main Card */}
            <Card className="rounded-[28px] border border-slate-200/80 bg-white/85 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
              <CardHeader className="border-b border-slate-200/70 px-6 py-5 dark:border-slate-800">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-xl font-semibold text-slate-900 dark:text-white">Exception Queue</CardTitle>
                    {/* Status tabs */}
                    <div className="mt-3 flex gap-1">
                      {STATUS_TABS.map(t => (
                        <button key={t} onClick={() => setActiveTab(t)} className={cn(
                          "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                          activeTab === t
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                        )}>
                          {t === "all" ? "All" : t.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())}
                          {" "}<span className="opacity-70">({tabCounts[t]})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search exceptions…" className="h-10 pl-9 w-52 rounded-xl" />
                    </div>
                    <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                      <SelectTrigger className="h-10 w-36 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Severities</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={() => setShowCreate(true)} className="h-10 rounded-xl bg-blue-600 px-4 text-white hover:bg-blue-700">
                      <Plus className="mr-1.5 h-4 w-4" /> New Exception
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-20 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                      <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">No exceptions {activeTab !== "all" ? `in "${activeTab.replace("_", " ")}"` : "found"}</p>
                    <p className="mt-1 text-sm text-slate-500">Everything looks clean. Create an exception manually if needed.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map(exc => {
                      const sev = SEVERITY_CONFIG[exc.severity];
                      const stat = STATUS_CONFIG[exc.status];
                      const SevIcon = sev.icon;
                      const TypeMeta = TYPE_META[exc.type];
                      const TypeIcon = TypeMeta.icon;
                      return (
                        <div key={exc.id} className={cn("flex items-start gap-4 px-6 py-5 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-900/30 border-l-4", sev.ring.replace("border", "border-l"))}>
                          <div className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", sev.bg, sev.ring)}>
                            <SevIcon className={cn("h-5 w-5", sev.color)} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900 dark:text-white">{exc.title}</span>
                              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", stat.color)}>{stat.label}</span>
                              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold border", sev.bg, sev.color, sev.ring)}>{sev.label}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                              <span className="flex items-center gap-1"><TypeIcon className="h-3.5 w-3.5" />{TypeMeta.label}</span>
                              <span className="capitalize">{exc.entityType}</span>
                              {exc.entityRef && <span className="font-mono">{exc.entityRef}</span>}
                              <span>{new Date(exc.createdAt).toLocaleDateString()}</span>
                            </div>
                            {exc.description && <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{exc.description}</p>}
                            {exc.resolution && (
                              <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                                Resolution: {exc.resolution}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col gap-2 items-end">
                            {exc.status === "open" && (
                              <button
                                onClick={() => updateMutation.mutate({ id: exc.id, status: "under_review" })}
                                className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400"
                              >Review</button>
                            )}
                            {(exc.status === "open" || exc.status === "under_review") && (
                              <>
                                <button
                                  onClick={() => { setResolveTarget(exc); setResolution(""); }}
                                  className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400"
                                >Resolve</button>
                                <button
                                  onClick={() => updateMutation.mutate({ id: exc.id, status: "waived" })}
                                  className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                                >Waive</button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      {/* Create Exception Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle>Create Exception</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Title</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Brief description of the exception" className="mt-1 rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as typeof f.type }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v as typeof f.severity }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Entity Type</Label>
                <Select value={form.entityType} onValueChange={v => setForm(f => ({ ...f, entityType: v as typeof f.entityType }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="payment">Payment</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="debtor">Debtor</SelectItem>
                    <SelectItem value="broker">Broker</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reference (optional)</Label>
                <Input value={form.entityRef} onChange={e => setForm(f => ({ ...f, entityRef: e.target.value }))} placeholder="Invoice#, ref…" className="mt-1 rounded-xl" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe the exception in detail…" className="mt-1 rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ ...form, entityRef: form.entityRef || null, description: form.description || null })} disabled={createMutation.isPending} className="rounded-xl bg-blue-600 text-white hover:bg-blue-700">
              {createMutation.isPending ? "Saving…" : "Create Exception"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={!!resolveTarget} onOpenChange={open => !open && setResolveTarget(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Resolve Exception</DialogTitle></DialogHeader>
          <div className="py-2">
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{resolveTarget?.title}</p>
            <Label>Resolution Notes</Label>
            <Textarea value={resolution} onChange={e => setResolution(e.target.value)} rows={4} placeholder="Describe how this was resolved…" className="mt-1 rounded-xl" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)} className="rounded-xl">Cancel</Button>
            <Button onClick={() => resolveTarget && updateMutation.mutate({ id: resolveTarget.id, status: "resolved", resolution })} disabled={updateMutation.isPending} className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">
              {updateMutation.isPending ? "Resolving…" : "Mark Resolved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
