import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ClipboardList,
  Search,
  User,
  FileText,
  ArrowRight,
  DollarSign,
  FileUp,
  Users,
  Banknote,
  Shield,
  Activity,
  RefreshCw,
} from "lucide-react";

type AuditEntry = {
  id: number;
  entityType: string;
  entityId: number;
  eventType: string;
  actorType: "user" | "system" | "client";
  actorId?: string | null;
  payloadJson?: Record<string, unknown> | null;
  createdAt: string;
  actorName?: string | null;
};

type StatusHistoryEntry = {
  id: number;
  invoiceId: number;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string | null;
  reason: string | null;
  createdAt: string;
  changedByName?: string | null;
};

type UnifiedEntry = {
  id: string;
  kind: "event" | "status";
  title: string;
  detail: string;
  entityType: string;
  entityId: number;
  actorName: string | null;
  actorType: string;
  createdAt: string;
  icon: React.ElementType;
  color: string;
};

const EVENT_ICON: Record<string, React.ElementType> = {
  invoice: FileText,
  client: Users,
  debtor: Users,
  load: FileUp,
  document: FileUp,
  user: User,
  payout: Banknote,
  vault: Shield,
  payment: DollarSign,
};

const ENTITY_COLOR: Record<string, string> = {
  invoice: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  client: "bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400",
  debtor: "bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400",
  load: "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400",
  document: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  user: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
  payout: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
  vault: "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400",
};

function formatEventType(et: string) {
  return et.replace(/\./g, " → ").replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function toUnified(events: AuditEntry[], statusHistory: StatusHistoryEntry[]): UnifiedEntry[] {
  const fromEvents: UnifiedEntry[] = events.map(e => ({
    id: `ev-${e.id}`,
    kind: "event",
    title: formatEventType(e.eventType),
    detail: e.entityType.charAt(0).toUpperCase() + e.entityType.slice(1) + (e.entityId ? ` #${e.entityId}` : ""),
    entityType: e.entityType,
    entityId: e.entityId,
    actorName: e.actorName ?? e.actorId ?? null,
    actorType: e.actorType,
    createdAt: e.createdAt,
    icon: EVENT_ICON[e.entityType] ?? Activity,
    color: ENTITY_COLOR[e.entityType] ?? "bg-slate-100 text-slate-600",
  }));

  const fromStatus: UnifiedEntry[] = statusHistory.map(s => ({
    id: `sh-${s.id}`,
    kind: "status",
    title: `Invoice Status Changed`,
    detail: `Invoice #${s.invoiceId}: ${s.oldStatus ?? "new"} → ${s.newStatus}`,
    entityType: "invoice",
    entityId: s.invoiceId,
    actorName: s.changedByName ?? s.changedBy ?? null,
    actorType: "user",
    createdAt: s.createdAt,
    icon: ArrowRight,
    color: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  }));

  return [...fromEvents, ...fromStatus].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export default function AuditLog() {
  const [search, setSearch] = useState("");
  const [filterEntity, setFilterEntity] = useState("all");
  const [filterActor, setFilterActor] = useState("all");

  const { data: events = [], isLoading: eventsLoading, refetch } = useQuery<AuditEntry[]>({
    queryKey: ["/api/audit/events"],
  });
  const { data: statusHistory = [], isLoading: histLoading } = useQuery<StatusHistoryEntry[]>({
    queryKey: ["/api/audit/status-history"],
  });

  const unified = useMemo(() => toUnified(events, statusHistory), [events, statusHistory]);

  const filtered = unified.filter(e => {
    if (filterEntity !== "all" && e.entityType !== filterEntity) return false;
    if (filterActor !== "all" && e.actorType !== filterActor) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.title.toLowerCase().includes(q) && !e.detail.toLowerCase().includes(q) && !(e.actorName?.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const entityTypes = Array.from(new Set(unified.map(e => e.entityType))).sort();

  const isLoading = eventsLoading || histLoading;

  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.06),_transparent_30%),linear-gradient(to_bottom,_#f8fafc,_#f1f5f9)] dark:bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Audit Log" subtitle="Complete event history — status changes, entity updates, and system actions" />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8 space-y-6">

            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Total Events", value: unified.length },
                { label: "Today", value: unified.filter(e => new Date(e.createdAt).toDateString() === new Date().toDateString()).length },
                { label: "System Events", value: unified.filter(e => e.actorType === "system").length },
                { label: "User Actions", value: unified.filter(e => e.actorType === "user").length },
              ].map(s => (
                <Card key={s.label} className="rounded-2xl border border-slate-200/80 bg-white/85 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{s.label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Main Log */}
            <Card className="rounded-[28px] border border-slate-200/80 bg-white/85 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
              <CardHeader className="border-b border-slate-200/70 px-6 py-5 dark:border-slate-800">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <CardTitle className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <ClipboardList className="h-5 w-5 text-slate-500" />
                    Event Timeline
                    <span className="ml-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{filtered.length}</span>
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events…" className="h-10 pl-9 w-52 rounded-xl" />
                    </div>
                    <Select value={filterEntity} onValueChange={setFilterEntity}>
                      <SelectTrigger className="h-10 w-36 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Entities</SelectItem>
                        {entityTypes.map(t => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={filterActor} onValueChange={setFilterActor}>
                      <SelectTrigger className="h-10 w-32 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Actors</SelectItem>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="system">System</SelectItem>
                      </SelectContent>
                    </Select>
                    <button onClick={() => refetch()} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </button>
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
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                      <ClipboardList className="h-7 w-7 text-slate-400" />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">No events found</p>
                    <p className="mt-1 text-sm text-slate-500">Events appear here as actions are performed in the system.</p>
                  </div>
                ) : (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-[3.5rem] top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-800" />
                    <div className="divide-y divide-slate-100/80 dark:divide-slate-800">
                      {filtered.map(e => {
                        const Icon = e.icon;
                        return (
                          <div key={e.id} className="flex items-start gap-4 px-6 py-4 hover:bg-slate-50/70 dark:hover:bg-slate-900/30 transition-colors">
                            <div className={cn("relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm", e.color)}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1 pt-0.5">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="text-sm font-semibold text-slate-900 dark:text-white">{e.title}</span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">{e.detail}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                                {e.actorName && (
                                  <span className="flex items-center gap-1">
                                    <User className="h-3 w-3" />
                                    {e.actorName}
                                  </span>
                                )}
                                <span className={cn(
                                  "rounded-full px-1.5 py-0.5 font-medium",
                                  e.actorType === "system" ? "bg-slate-100 text-slate-500 dark:bg-slate-800" : "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
                                )}>{e.actorType}</span>
                              </div>
                            </div>
                            <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500 tabular-nums pt-1">{timeAgo(e.createdAt)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
