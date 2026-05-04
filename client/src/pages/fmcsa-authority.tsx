import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Building2,
  Truck,
  History,
  Bell,
  KeyRound,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

interface AuthorityCheck {
  id: number;
  entityType: "broker" | "debtor";
  entityId: number;
  entityName: string | null;
  mcNumber: string | null;
  dotNumber: string | null;
  legalName: string | null;
  dbaName: string | null;
  operatingStatus: string | null;
  commonAuthorityStatus: string | null;
  contractAuthorityStatus: string | null;
  brokerAuthorityStatus: string | null;
  allowedToOperate: boolean | null;
  carrierOperation: string | null;
  checkStatus: "success" | "not_found" | "api_error" | "no_key";
  errorMessage: string | null;
  checkedAt: string;
  checkedBy: string | null;
}

interface AuthorityAlert {
  id: number;
  entityType: "broker" | "debtor";
  entityId: number;
  entityName: string | null;
  mcNumber: string | null;
  dotNumber: string | null;
  alertType: string;
  previousStatus: string | null;
  newStatus: string | null;
  field: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  notes: string | null;
  createdAt: string;
}

interface RunSummary {
  total: number;
  success: number;
  notFound: number;
  apiError: number;
  noKey: number;
  alertsCreated: number;
  errors: string[];
}

interface EntityHistory {
  entityType: string;
  entityId: number;
  entityName: string;
  checks: AuthorityCheck[];
}

function statusBadge(check: AuthorityCheck) {
  if (check.checkStatus === "no_key") {
    return <Badge className="bg-slate-100 text-slate-600 border-slate-300">No API Key</Badge>;
  }
  if (check.checkStatus === "api_error") {
    return <Badge className="bg-orange-100 text-orange-700 border-orange-300">API Error</Badge>;
  }
  if (check.checkStatus === "not_found") {
    return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300">Not Found</Badge>;
  }

  const active =
    check.allowedToOperate !== false &&
    ["active", "authorized"].some(
      k =>
        (check.commonAuthorityStatus ?? "").toLowerCase().includes(k) ||
        (check.brokerAuthorityStatus ?? "").toLowerCase().includes(k)
    );

  if (active) {
    return <Badge className="bg-green-100 text-green-700 border-green-300 font-semibold">Active</Badge>;
  }

  const inactive = ["inactive", "not authorized", "revoked"].some(
    k =>
      (check.commonAuthorityStatus ?? "").toLowerCase().includes(k) ||
      (check.brokerAuthorityStatus ?? "").toLowerCase().includes(k) ||
      check.allowedToOperate === false
  );

  if (inactive) {
    return <Badge className="bg-red-100 text-red-700 border-red-300 font-semibold">Inactive / Revoked</Badge>;
  }

  return <Badge className="bg-slate-100 text-slate-600">Unknown</Badge>;
}

function alertTypeBadge(type: string) {
  const map: Record<string, string> = {
    became_inactive: "bg-red-100 text-red-700",
    authority_revoked: "bg-red-100 text-red-700",
    status_changed: "bg-yellow-100 text-yellow-700",
    not_found: "bg-orange-100 text-orange-700",
    api_error: "bg-slate-100 text-slate-600",
  };
  const label = type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return <Badge className={cn("text-xs", map[type] ?? "bg-slate-100 text-slate-600")}>{label}</Badge>;
}

export default function FmcsaAuthority() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "broker" | "debtor">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive" | "issues">("all");
  const [resolveTarget, setResolveTarget] = useState<AuthorityAlert | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [webKeyInput, setWebKeyInput] = useState("");

  const { data: latestChecks = [], isLoading: checksLoading } = useQuery<AuthorityCheck[]>({
    queryKey: ["/api/authority-checks/latest"],
  });

  const { data: alerts = [], isLoading: alertsLoading } = useQuery<AuthorityAlert[]>({
    queryKey: ["/api/authority-alerts"],
  });

  const { data: history } = useQuery<EntityHistory>({
    queryKey: ["/api/authority-checks/history", expandedHistory],
    enabled: !!expandedHistory,
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/authority-checks/run").then(r => r.json()) as Promise<RunSummary>,
    onSuccess: async (data: RunSummary) => {
      queryClient.invalidateQueries({ queryKey: ["/api/authority-checks/latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/authority-alerts"] });
      toast({
        title: "Authority check complete",
        description: `Checked ${data.total} entities — ${data.alertsCreated} alert(s) created`,
      });
    },
    onError: () => toast({ title: "Check failed", variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: (payload: { id: number; notes: string }) =>
      apiRequest("PATCH", `/api/authority-alerts/${payload.id}/resolve`, { notes: payload.notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/authority-alerts"] });
      setResolveTarget(null);
      setResolveNotes("");
      toast({ title: "Alert resolved" });
    },
  });

  const saveKeyMutation = useMutation({
    mutationFn: (key: string) => apiRequest("POST", "/api/authority-checks/configure-key", { webKey: key }),
    onSuccess: () => {
      toast({ title: "FMCSA Web Key saved", description: "Daily checks are now enabled." });
      setWebKeyInput("");
    },
    onError: () => toast({ title: "Failed to save key", variant: "destructive" }),
  });

  const openAlerts = alerts.filter(a => !a.resolvedAt);
  const hasNoKey = latestChecks.some(c => c.checkStatus === "no_key");

  const filtered = latestChecks.filter(c => {
    if (filterType !== "all" && c.entityType !== filterType) return false;
    if (search && !(
      (c.entityName ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.mcNumber ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.dotNumber ?? "").toLowerCase().includes(search.toLowerCase())
    )) return false;
    if (filterStatus === "active") {
      if (c.checkStatus !== "success") return false;
      const ok = (c.commonAuthorityStatus ?? "").toLowerCase().includes("active") ||
        (c.brokerAuthorityStatus ?? "").toLowerCase().includes("active");
      return ok && c.allowedToOperate !== false;
    }
    if (filterStatus === "inactive") {
      return ["inactive", "not authorized"].some(
        k => (c.commonAuthorityStatus ?? "").toLowerCase().includes(k) ||
          (c.brokerAuthorityStatus ?? "").toLowerCase().includes(k)
      ) || c.allowedToOperate === false;
    }
    if (filterStatus === "issues") {
      return c.checkStatus === "not_found" || c.checkStatus === "api_error" || c.checkStatus === "no_key";
    }
    return true;
  });

  const stats = {
    total: latestChecks.length,
    active: latestChecks.filter(c =>
      c.checkStatus === "success" &&
      c.allowedToOperate !== false &&
      ["active"].some(k => (c.commonAuthorityStatus ?? "").toLowerCase().includes(k))
    ).length,
    inactive: latestChecks.filter(c =>
      ["inactive", "not authorized"].some(
        k => (c.commonAuthorityStatus ?? "").toLowerCase().includes(k)
      ) || c.allowedToOperate === false
    ).length,
    issues: latestChecks.filter(c => ["not_found", "api_error", "no_key"].includes(c.checkStatus)).length,
    openAlerts: openAlerts.length,
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav title="FMCSA Authority" />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-7xl space-y-6">

            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  FMCSA Authority Checks
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Daily broker &amp; carrier authority monitoring via FMCSA SAFER
                </p>
              </div>
              <Button
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending}
                className="gap-2"
              >
                <RefreshCw className={cn("h-4 w-4", runMutation.isPending && "animate-spin")} />
                {runMutation.isPending ? "Running…" : "Run Check Now"}
              </Button>
            </div>

            {/* No-Key Warning Banner */}
            {hasNoKey && (
              <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
                <CardContent className="flex items-start gap-3 py-4">
                  <KeyRound className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-amber-800 dark:text-amber-300">
                      FMCSA Web Key Required
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">
                      Add your FMCSA developer web key to enable live authority lookups.
                      Get one at{" "}
                      <a
                        href="https://www.fmcsa.dot.gov/developer/qcapi"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline font-medium"
                      >
                        fmcsa.dot.gov/developer/qcapi
                      </a>
                    </p>
                    <div className="flex gap-2 mt-3">
                      <Input
                        placeholder="Paste your FMCSA web key…"
                        value={webKeyInput}
                        onChange={e => setWebKeyInput(e.target.value)}
                        className="max-w-sm text-sm"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!webKeyInput.trim() || saveKeyMutation.isPending}
                        onClick={() => saveKeyMutation.mutate(webKeyInput.trim())}
                      >
                        Save Key
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Stat Cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {[
                { label: "Monitored", value: stats.total, icon: Building2, color: "text-blue-600" },
                { label: "Active", value: stats.active, icon: ShieldCheck, color: "text-green-600" },
                { label: "Inactive", value: stats.inactive, icon: ShieldX, color: "text-red-600" },
                { label: "Issues", value: stats.issues, icon: AlertTriangle, color: "text-orange-500" },
                { label: "Open Alerts", value: stats.openAlerts, icon: Bell, color: "text-purple-600" },
              ].map(s => (
                <Card key={s.label}>
                  <CardContent className="flex items-center gap-3 py-4">
                    <s.icon className={cn("h-8 w-8 shrink-0", s.color)} />
                    <div>
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">{s.value}</p>
                      <p className="text-xs text-slate-500">{s.label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Tabs */}
            <Tabs defaultValue="status">
              <TabsList>
                <TabsTrigger value="status">Authority Status</TabsTrigger>
                <TabsTrigger value="alerts" className="relative">
                  Alerts
                  {openAlerts.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-red-500 text-white text-[10px] px-1.5 py-0.5 leading-none">
                      {openAlerts.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── Status Tab ── */}
              <TabsContent value="status" className="mt-4 space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap gap-3 items-center">
                  <div className="relative flex-1 min-w-52 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      placeholder="Search entity, MC, DOT…"
                      className="pl-9 text-sm"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-1">
                    {(["all", "broker", "debtor"] as const).map(t => (
                      <Button
                        key={t}
                        size="sm"
                        variant={filterType === t ? "default" : "outline"}
                        onClick={() => setFilterType(t)}
                        className="capitalize"
                      >
                        {t === "all" ? "All Types" : t === "broker" ? "Brokers" : "Debtors"}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {(["all", "active", "inactive", "issues"] as const).map(s => (
                      <Button
                        key={s}
                        size="sm"
                        variant={filterStatus === s ? "default" : "outline"}
                        onClick={() => setFilterStatus(s)}
                        className="capitalize"
                      >
                        {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Table */}
                <Card>
                  <CardContent className="p-0">
                    {checksLoading ? (
                      <div className="flex items-center justify-center py-16 text-slate-400">
                        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading…
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                        <ShieldCheck className="h-10 w-10" />
                        <p className="text-sm">
                          {latestChecks.length === 0
                            ? 'No checks yet — click "Run Check Now" to start'
                            : "No matches for the current filters"}
                        </p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Entity</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>MC / DOT</TableHead>
                            <TableHead>Authority Status</TableHead>
                            <TableHead>Operating Status</TableHead>
                            <TableHead>Last Checked</TableHead>
                            <TableHead>History</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map(c => {
                            const histKey = `${c.entityType}-${c.entityId}`;
                            const expanded = expandedHistory === histKey;
                            return (
                              <>
                                <TableRow key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                  <TableCell>
                                    <div>
                                      <p className="font-medium text-slate-900 dark:text-white">
                                        {c.entityName ?? "—"}
                                      </p>
                                      {c.legalName && c.legalName !== c.entityName && (
                                        <p className="text-xs text-slate-400">{c.legalName}</p>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                      {c.entityType === "broker" ? (
                                        <Building2 className="h-3.5 w-3.5" />
                                      ) : (
                                        <Truck className="h-3.5 w-3.5" />
                                      )}
                                      <span className="capitalize">{c.entityType}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-xs font-mono text-slate-600 dark:text-slate-300 space-y-0.5">
                                      {c.mcNumber && <div>MC: {c.mcNumber}</div>}
                                      {c.dotNumber && <div>DOT: {c.dotNumber}</div>}
                                      {!c.mcNumber && !c.dotNumber && <span className="text-slate-400">—</span>}
                                    </div>
                                  </TableCell>
                                  <TableCell>{statusBadge(c)}</TableCell>
                                  <TableCell>
                                    <span className="text-xs text-slate-600 dark:text-slate-300">
                                      {c.operatingStatus ?? "—"}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1 text-xs text-slate-500">
                                      <Clock className="h-3.5 w-3.5" />
                                      {formatDistanceToNow(new Date(c.checkedAt), { addSuffix: true })}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs gap-1"
                                      onClick={() => setExpandedHistory(expanded ? null : histKey)}
                                    >
                                      <History className="h-3.5 w-3.5" />
                                      {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                                {expanded && (
                                  <TableRow key={`${c.id}-history`}>
                                    <TableCell colSpan={7} className="bg-slate-50 dark:bg-slate-800/30 px-6 py-3">
                                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                        Check History — {c.entityName}
                                      </p>
                                      {!history ? (
                                        <p className="text-xs text-slate-400">Loading…</p>
                                      ) : history.checks.length === 0 ? (
                                        <p className="text-xs text-slate-400">No history found.</p>
                                      ) : (
                                        <div className="space-y-1 max-h-56 overflow-y-auto">
                                          {history.checks.map(h => (
                                            <div
                                              key={h.id}
                                              className="flex items-center gap-3 text-xs py-1 border-b border-slate-100 dark:border-slate-700 last:border-0"
                                            >
                                              <span className="text-slate-400 shrink-0 w-36">
                                                {format(new Date(h.checkedAt), "MMM d, yyyy HH:mm")}
                                              </span>
                                              {statusBadge(h)}
                                              <span className="text-slate-500">
                                                {h.commonAuthorityStatus ?? h.errorMessage ?? "—"}
                                              </span>
                                              <span className="text-slate-400 ml-auto">{h.checkedBy ?? "system"}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                )}
                              </>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Alerts Tab ── */}
              <TabsContent value="alerts" className="mt-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-slate-500" />
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Alerts are created automatically when a broker or debtor's authority status changes between checks.
                  </p>
                </div>

                {alertsLoading ? (
                  <div className="flex items-center justify-center py-16 text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading…
                  </div>
                ) : alerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                    <CheckCircle className="h-10 w-10 text-green-400" />
                    <p className="text-sm">No authority alerts — all statuses nominal</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {alerts.map(a => (
                      <Card
                        key={a.id}
                        className={cn(
                          "border",
                          a.resolvedAt
                            ? "opacity-60 border-slate-200"
                            : a.alertType === "became_inactive" || a.alertType === "authority_revoked"
                            ? "border-red-300 bg-red-50/50 dark:bg-red-950/10"
                            : "border-yellow-300 bg-yellow-50/50 dark:bg-yellow-950/10"
                        )}
                      >
                        <CardContent className="flex items-start gap-4 py-4">
                          <div className="shrink-0 mt-0.5">
                            {a.resolvedAt ? (
                              <CheckCircle className="h-5 w-5 text-green-500" />
                            ) : a.alertType === "became_inactive" || a.alertType === "authority_revoked" ? (
                              <ShieldX className="h-5 w-5 text-red-500" />
                            ) : (
                              <ShieldAlert className="h-5 w-5 text-yellow-600" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {a.entityName ?? `${a.entityType} #${a.entityId}`}
                              </span>
                              {alertTypeBadge(a.alertType)}
                              {a.resolvedAt && (
                                <Badge className="bg-green-100 text-green-700 text-xs">Resolved</Badge>
                              )}
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-300 space-y-0.5">
                              {a.field && <p><span className="font-medium">Field:</span> {a.field}</p>}
                              {a.previousStatus && a.newStatus && (
                                <p>
                                  <span className="font-medium">Change:</span>{" "}
                                  <span className="line-through text-slate-400">{a.previousStatus}</span>{" "}
                                  → <span className="font-medium text-red-600">{a.newStatus}</span>
                                </p>
                              )}
                              {a.notes && <p className="text-xs text-slate-500 mt-1 italic">{a.notes}</p>}
                            </div>
                            <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                              <Clock className="h-3.5 w-3.5" />
                              {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                              {a.mcNumber && <span>· MC: {a.mcNumber}</span>}
                              {a.dotNumber && <span>· DOT: {a.dotNumber}</span>}
                            </div>
                          </div>
                          {!a.resolvedAt && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              onClick={() => { setResolveTarget(a); setResolveNotes(""); }}
                            >
                              Resolve
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>

          </div>
        </main>
      </div>

      {/* Resolve Dialog */}
      <Dialog open={!!resolveTarget} onOpenChange={() => { setResolveTarget(null); setResolveNotes(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve Alert</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Resolving alert for <strong>{resolveTarget?.entityName}</strong>
              {resolveTarget?.alertType && ` — ${resolveTarget.alertType.replace(/_/g, " ")}`}
            </p>
            <Textarea
              placeholder="Resolution notes (optional)…"
              value={resolveNotes}
              onChange={e => setResolveNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)}>Cancel</Button>
            <Button
              disabled={resolveMutation.isPending}
              onClick={() => resolveTarget && resolveMutation.mutate({ id: resolveTarget.id, notes: resolveNotes })}
            >
              Mark Resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
