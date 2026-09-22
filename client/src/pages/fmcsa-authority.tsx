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
import { useAuth } from "@/hooks/useAuth";
import {
  win95TabsListClassName,
  win95TabsTriggerClassName,
} from "@/components/win95";

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
  // Insurance / bond
  bipdRequired: string | null;
  bipdInsuranceOnFile: string | null;
  cargoInsuranceRequired: string | null;
  cargoInsuranceOnFile: string | null;
  brokerBondStatus: string | null;
  bondAmount: string | null;
  // Change tracking
  changeSummary: string | null;
  integrationRunId: number | null;
  checkStatus: "ok" | "error" | "skipped";
  authorityStatus: "ACTIVE" | "INACTIVE" | "NOT_AUTHORIZED" | "UNKNOWN" | null;
  checkError: string | null;
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
  severity: "low" | "medium" | "high" | "critical" | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  notes: string | null;
  createdAt: string;
}

interface ComplianceIntegrationRun {
  id: number;
  runType: "scheduled" | "manual";
  triggeredBy: string;
  status: "running" | "completed" | "failed" | "skipped";
  reason: string | null;
  startedAt: string;
  completedAt: string | null;
  totalChecked: number | null;
  successCount: number | null;
  failureCount: number | null;
  notFoundCount: number | null;
  noKeyCount: number | null;
  alertsCreated: number | null;
  errorLog: string[] | null;
}

interface RunSummary {
  runId: number;
  status: "completed" | "failed" | "skipped";
  reason?: string;
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

interface FmcsaKeyStatus {
  configured: boolean;
  maskedKey: string | null;
  source: "database" | "environment" | null;
}

interface FmcsaLookupResult {
  identifierType: "MC" | "DOT";
  identifier: string;
  carrier: {
    dotNumber?: string;
    legalName?: string;
    dbaName?: string;
    allowedToOperate?: "Y" | "N";
    operatingStatus?: string;
    commonAuthorityStatus?: string;
    contractAuthorityStatus?: string;
    brokerAuthorityStatus?: string;
    carrierOperation?: string;
    safetyRating?: string;
    bipdRequired?: string;
    bipdInsuranceOnFile?: string;
    cargoInsuranceRequired?: string;
    cargoInsuranceOnFile?: string;
    brokerBondStatus?: string;
    bondAmount?: string;
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(error.message);
    return parsed?.message || fallback;
  } catch {
    return error.message || fallback;
  }
}

function statusBadge(check: AuthorityCheck) {
  const styles: Record<NonNullable<AuthorityCheck["authorityStatus"]>, string> = {
    ACTIVE: "bg-green-100 text-green-700 border-green-300",
    INACTIVE: "bg-red-100 text-red-700 border-red-300",
    NOT_AUTHORIZED: "bg-red-100 text-red-800 border-red-400",
    UNKNOWN: "bg-slate-100 text-slate-600 border-slate-300",
  };
  const value = check.authorityStatus ?? "UNKNOWN";
  return (
    <Badge className={cn("font-semibold", styles[value])}>
      {value.replace("_", " ")}
    </Badge>
  );
}

function alertTypeBadge(type: string) {
  const map: Record<string, string> = {
    became_inactive: "bg-red-100 text-red-700",
    authority_revoked: "bg-red-100 text-red-700",
    status_changed: "bg-yellow-100 text-yellow-700",
    not_found: "bg-orange-100 text-orange-700",
    insurance_lapsed: "bg-purple-100 text-purple-700",
    api_error: "bg-slate-100 text-slate-600",
  };
  const label = type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return <Badge className={cn("text-xs", map[type] ?? "bg-slate-100 text-slate-600")}>{label}</Badge>;
}

function severityBadge(severity: string | null) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-800 border-red-300",
    high: "bg-orange-100 text-orange-700 border-orange-300",
    medium: "bg-yellow-100 text-yellow-700 border-yellow-300",
    low: "bg-slate-100 text-slate-600 border-slate-300",
  };
  if (!severity) return null;
  return (
    <Badge className={cn("text-[10px] uppercase tracking-wide", map[severity] ?? "bg-slate-100 text-slate-600")}>
      {severity}
    </Badge>
  );
}

function insuranceBadge(onFile: string | null, label: string) {
  if (!onFile) return null;
  const ok = onFile === "Y";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded",
      ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
      {label}: {ok ? "On File" : "Not On File"}
    </span>
  );
}

function runStatusBadge(status: string) {
  const map: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    running: "bg-blue-100 text-blue-700",
    failed: "bg-red-100 text-red-700",
  };
  return <Badge className={cn("text-xs capitalize", map[status] ?? "bg-slate-100 text-slate-600")}>{status}</Badge>;
}

export default function FmcsaAuthority() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "broker" | "debtor">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive" | "issues">("all");
  const [resolveTarget, setResolveTarget] = useState<AuthorityAlert | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [webKeyInput, setWebKeyInput] = useState("");
  const [lookupInput, setLookupInput] = useState("");
  const [lookupResult, setLookupResult] = useState<FmcsaLookupResult | null>(null);
  const [runResult, setRunResult] = useState<RunSummary | null>(null);

  const {
    data: keyStatus,
    isLoading: keyStatusLoading,
    isError: keyStatusError,
  } = useQuery<FmcsaKeyStatus>({
    queryKey: ["/api/fmcsa/status"],
  });

  const { data: latestChecks = [], isLoading: checksLoading } = useQuery<AuthorityCheck[]>({
    queryKey: ["/api/authority-checks/latest"],
  });

  const { data: alerts = [], isLoading: alertsLoading } = useQuery<AuthorityAlert[]>({
    queryKey: ["/api/authority-alerts"],
  });

  const { data: integrationRuns = [], isLoading: runsLoading } = useQuery<ComplianceIntegrationRun[]>({
    queryKey: ["/api/authority-checks/integration-runs"],
  });

  const [historyEntityType, historyEntityId] = expandedHistory?.split("-") ?? [];
  const {
    data: history,
    isError: historyError,
    error: historyErrorValue,
    isFetching: historyLoading,
    refetch: refetchHistory,
  } = useQuery<EntityHistory>({
    queryKey: [`/api/fmcsa/entities/${historyEntityId}/history?entityType=${historyEntityType}`],
    enabled: !!expandedHistory,
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/authority-checks/run").then(r => r.json()) as Promise<RunSummary>,
    onSuccess: async (data: RunSummary) => {
      setRunResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/authority-checks/latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/authority-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/authority-checks/integration-runs"] });
      toast({
        title: data.status === "skipped" ? "Authority check skipped" : "Authority check complete",
        description: data.reason ?? `Run #${data.runId} — ${data.success + data.apiError} entities checked, ${data.alertsCreated} alert(s) created`,
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
    mutationFn: async (key: string) => {
      console.info("[MC Check] Saving FMCSA Web Key");
      const response = await apiRequest("POST", "/api/settings/fmcsa-key", { webKey: key });
      const data = await response.json() as FmcsaKeyStatus & { ok: boolean };
      console.info("[MC Check] FMCSA Web Key save response", {
        ok: data.ok,
        configured: data.configured,
        source: data.source,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/settings/fmcsa-key"], data);
      queryClient.setQueryData(["/api/fmcsa/status"], { ...data, paused: !data.configured });
      toast({ title: "FMCSA key saved successfully", className: "border-green-600 bg-green-50 text-green-900" });
      setWebKeyInput("");
    },
    onError: (error) => {
      const message = errorMessage(error, "Failed to save FMCSA Web Key");
      console.error("[MC Check] FMCSA Web Key save failed", message);
      toast({ title: "Failed to save FMCSA key", description: message, variant: "destructive" });
    },
  });

  const lookupMutation = useMutation({
    mutationFn: async (identifier: string) => {
      const response = await apiRequest("POST", "/api/authority-checks/lookup", { identifier });
      return response.json() as Promise<FmcsaLookupResult>;
    },
    onMutate: () => setLookupResult(null),
    onSuccess: (data) => setLookupResult(data),
    onError: (error) => {
      setLookupResult(null);
      toast({
        title: "FMCSA lookup failed",
        description: errorMessage(error, "Unable to complete the FMCSA lookup"),
        variant: "destructive",
      });
    },
  });

  const openAlerts = alerts.filter(a => !a.resolvedAt);
  const hasNoKey = keyStatus?.configured === false;
  const canConfigureKey = user?.role === "admin";

  const filtered = latestChecks.filter(c => {
    if (filterType !== "all" && c.entityType !== filterType) return false;
    if (search && !(
      (c.entityName ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.mcNumber ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.dotNumber ?? "").toLowerCase().includes(search.toLowerCase())
    )) return false;
    if (filterStatus === "active") {
      return c.checkStatus === "ok" && c.authorityStatus === "ACTIVE";
    }
    if (filterStatus === "inactive") {
      return c.checkStatus === "ok" &&
        (c.authorityStatus === "INACTIVE" || c.authorityStatus === "NOT_AUTHORIZED");
    }
    if (filterStatus === "issues") {
      return c.checkStatus === "error" ||
        c.authorityStatus === "INACTIVE" ||
        c.authorityStatus === "NOT_AUTHORIZED";
    }
    return true;
  });

  const stats = {
    total: latestChecks.length,
    active: latestChecks.filter(c =>
      c.checkStatus === "ok" && c.authorityStatus === "ACTIVE"
    ).length,
    inactive: latestChecks.filter(c =>
      c.authorityStatus === "INACTIVE" || c.authorityStatus === "NOT_AUTHORIZED"
    ).length,
    issues: latestChecks.filter(c =>
      c.checkStatus === "error" ||
      c.authorityStatus === "INACTIVE" ||
      c.authorityStatus === "NOT_AUTHORIZED"
    ).length,
    openAlerts: openAlerts.length,
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav title="FMCSA Monitor" subtitle="Carrier authority status, safety ratings, and compliance alerts" group="Risk" />
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
              {canConfigureKey && (
                <Button
                  onClick={() => runMutation.mutate()}
                  disabled={runMutation.isPending}
                  className="gap-2"
                >
                  <RefreshCw className={cn("h-4 w-4", runMutation.isPending && "animate-spin")} />
                  {runMutation.isPending ? "Running…" : "Run now"}
                </Button>
              )}
            </div>

            {hasNoKey && (
              <div className="flex items-center gap-3 border-2 border-t-white border-l-white border-r-[#808080] border-b-[#808080] bg-[#fff4c2] px-4 py-3 text-[#5f4600] shadow-[2px_2px_0_rgba(128,128,128,0.35)]">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <p className="text-sm font-bold">
                  FMCSA web key not configured — checks are paused. Add FMCSA_WEBKEY in secrets.
                </p>
              </div>
            )}

            {runResult && (
              <div className={cn(
                "border-2 border-t-white border-l-white border-r-[#808080] border-b-[#808080] px-4 py-3 shadow-[2px_2px_0_rgba(128,128,128,0.35)]",
                runResult.status === "failed" ? "bg-red-50 text-red-900" :
                  runResult.status === "skipped" ? "bg-amber-50 text-amber-900" :
                    "bg-green-50 text-green-900",
              )}>
                <p className="text-sm font-bold">
                  Run #{runResult.runId}: {runResult.status}
                </p>
                <p className="mt-1 text-xs">
                  {runResult.reason ?? `${runResult.success} successful, ${runResult.apiError} errors, ${runResult.alertsCreated} alerts created.`}
                </p>
              </div>
            )}

            {/* FMCSA key configuration */}
            <Card className={cn((hasNoKey || keyStatusError) && "border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700")}>
              <CardContent className="flex items-start gap-3 py-4">
                <KeyRound className={cn("h-5 w-5 shrink-0 mt-0.5", hasNoKey || keyStatusError ? "text-amber-600" : "text-green-600")} />
                <div className="flex-1 min-w-0">
                  <p className={cn("font-semibold", hasNoKey || keyStatusError ? "text-amber-800 dark:text-amber-300" : "text-slate-900 dark:text-white")}>
                    {hasNoKey ? "FMCSA Web Key Required" : "FMCSA Web Key"}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                    {keyStatusError
                      ? "FMCSA key status could not be loaded. Contact an administrator."
                      : keyStatusLoading
                        ? "Checking configuration…"
                        : hasNoKey
                      ? "Please configure your FMCSA Web Key above to use MC Check"
                      : `Configured: ${keyStatus?.maskedKey ?? "Loading…"}`}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {canConfigureKey && (
                      <>
                        <Input
                          type="password"
                          autoComplete="off"
                          placeholder={keyStatus?.configured ? "Enter a new key to replace the saved key" : "Paste your FMCSA Web Key…"}
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
                          {saveKeyMutation.isPending ? "Saving…" : "Save Key"}
                        </Button>
                      </>
                    )}
                    <a
                      href="https://www.fmcsa.dot.gov/developer/qcapi"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="self-center text-xs font-medium text-slate-600 underline"
                    >
                      Get a key from FMCSA
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Live MC / DOT lookup */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">MC / DOT Lookup</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="Enter MC# or DOT# (example: MC-123456)"
                    value={lookupInput}
                    onChange={e => setLookupInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && lookupInput.trim()) {
                        e.preventDefault();
                        lookupMutation.mutate(lookupInput.trim());
                      }
                    }}
                    className="max-w-sm"
                  />
                  <Button
                    onClick={() => lookupMutation.mutate(lookupInput.trim())}
                    disabled={!lookupInput.trim() || lookupMutation.isPending}
                    className="gap-2"
                  >
                    <Search className="h-4 w-4" />
                    {lookupMutation.isPending ? "Searching…" : "Search FMCSA"}
                  </Button>
                </div>

                {hasNoKey && (
                  <p className="text-sm font-medium text-amber-700">
                    Please configure your FMCSA Web Key above to use MC Check
                  </p>
                )}

                {lookupResult && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {lookupResult.carrier.legalName ?? "FMCSA Carrier"}
                        </p>
                        {lookupResult.carrier.dbaName && (
                          <p className="text-sm text-slate-500">DBA {lookupResult.carrier.dbaName}</p>
                        )}
                        <p className="mt-1 text-xs font-mono text-slate-500">
                          {lookupResult.identifierType}# {lookupResult.identifier}
                          {lookupResult.carrier.dotNumber ? ` · DOT# ${lookupResult.carrier.dotNumber}` : ""}
                        </p>
                      </div>
                      <Badge className={lookupResult.carrier.allowedToOperate === "Y"
                        ? "bg-green-100 text-green-700 border-green-300"
                        : lookupResult.carrier.allowedToOperate === "N"
                          ? "bg-red-100 text-red-700 border-red-300"
                          : "bg-slate-100 text-slate-700 border-slate-300"}>
                        {lookupResult.carrier.allowedToOperate === "Y"
                          ? "Authorized"
                          : lookupResult.carrier.allowedToOperate === "N"
                            ? "Not Authorized"
                            : "Unknown"}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      <div><span className="text-slate-500">Operating status:</span><br />{lookupResult.carrier.operatingStatus ?? "Not reported"}</div>
                      <div><span className="text-slate-500">Common authority:</span><br />{lookupResult.carrier.commonAuthorityStatus ?? "Not reported"}</div>
                      <div><span className="text-slate-500">Broker authority:</span><br />{lookupResult.carrier.brokerAuthorityStatus ?? "Not reported"}</div>
                      <div><span className="text-slate-500">Safety rating:</span><br />{lookupResult.carrier.safetyRating ?? "Not reported"}</div>
                      <div><span className="text-slate-500">Carrier operation:</span><br />{lookupResult.carrier.carrierOperation ?? "Not reported"}</div>
                      <div><span className="text-slate-500">BIPD insurance:</span><br />{lookupResult.carrier.bipdInsuranceOnFile ?? "Not reported"}</div>
                      <div><span className="text-slate-500">Cargo insurance:</span><br />{lookupResult.carrier.cargoInsuranceOnFile ?? "Not reported"}</div>
                      <div><span className="text-slate-500">Broker bond:</span><br />{lookupResult.carrier.brokerBondStatus ?? "Not reported"}</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

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
                <TabsTrigger value="runs">Run History</TabsTrigger>
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
                  <div className={win95TabsListClassName}>
                    {(["all", "broker", "debtor"] as const).map(t => {
                      const active = filterType === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={active}
                          data-state={active ? "active" : "inactive"}
                          onClick={() => setFilterType(t)}
                          className={win95TabsTriggerClassName}
                        >
                          {t === "all" ? "All Types" : t === "broker" ? "Brokers" : "Debtors"}
                        </button>
                      );
                    })}
                  </div>
                  <div className={win95TabsListClassName}>
                    {(["all", "active", "inactive", "issues"] as const).map(s => {
                      const active = filterStatus === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={active}
                          data-state={active ? "active" : "inactive"}
                          onClick={() => setFilterStatus(s)}
                          className={win95TabsTriggerClassName}
                        >
                          {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                      );
                    })}
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
                            : filterStatus === "issues"
                              ? "No issues found — this filter shows request errors and inactive or unauthorized authority records."
                              : filterStatus === "active"
                                ? "No active FMCSA authority records match the current filters."
                                : filterStatus === "inactive"
                                  ? "No inactive or unauthorized FMCSA authority records match the current filters."
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
                                  <TableCell>
                                    <div className="space-y-1">
                                      {statusBadge(c)}
                                      {(c.checkStatus !== "ok" || c.checkError) && (c.checkError || c.errorMessage) && (
                                        <p className="max-w-56 text-[10px] leading-tight text-slate-500">
                                          {c.checkError || c.errorMessage}
                                        </p>
                                      )}
                                    </div>
                                  </TableCell>
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
                                      {historyError ? (
                                        <div className="flex items-center gap-2">
                                          <p className="text-xs text-red-600">
                                            Failed to load history: {errorMessage(historyErrorValue, "Unknown error")}
                                          </p>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-xs"
                                            onClick={() => refetchHistory()}
                                          >
                                            Retry
                                          </Button>
                                        </div>
                                      ) : !history ? (
                                        <p className="text-xs text-slate-400">{historyLoading ? "Loading…" : "No checks recorded yet"}</p>
                                      ) : history.checks.length === 0 ? (
                                        <p className="text-xs text-slate-400">No checks recorded yet</p>
                                      ) : (
                                        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                                          {history.checks.map(h => (
                                            <div
                                              key={h.id}
                                              className="flex flex-col gap-1 text-xs py-2 border-b border-slate-100 dark:border-slate-700 last:border-0"
                                            >
                                              <div className="flex items-center gap-3">
                                                <span className="text-slate-400 shrink-0 w-36">
                                                  {format(new Date(h.checkedAt), "MMM d, yyyy HH:mm")}
                                                </span>
                                                {statusBadge(h)}
                                                <span className="text-slate-500">
                                                  {h.commonAuthorityStatus ?? h.errorMessage ?? "—"}
                                                </span>
                                                {h.integrationRunId && (
                                                  <span className="text-slate-400 text-[10px]">Run #{h.integrationRunId}</span>
                                                )}
                                                <span className="text-slate-400 ml-auto">{h.checkedBy ?? "system"}</span>
                                              </div>
                                              {/* Insurance / bond pills */}
                                              {(h.bipdInsuranceOnFile || h.cargoInsuranceOnFile || h.brokerBondStatus) && (
                                                <div className="flex flex-wrap gap-1 pl-36">
                                                  {insuranceBadge(h.bipdInsuranceOnFile, "BIPD")}
                                                  {insuranceBadge(h.cargoInsuranceOnFile, "Cargo")}
                                                  {h.brokerBondStatus && (
                                                    <span className={cn(
                                                      "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded",
                                                      h.brokerBondStatus ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                                                    )}>
                                                      Bond: {h.brokerBondStatus}
                                                      {h.bondAmount && ` ($${Number(h.bondAmount).toLocaleString()})`}
                                                    </span>
                                                  )}
                                                </div>
                                              )}
                                              {/* Change summary */}
                                              {h.changeSummary && h.changeSummary !== "No changes detected." && (
                                                <p className="pl-36 text-[10px] text-amber-700 italic">{h.changeSummary}</p>
                                              )}
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

              {/* ── Run History Tab ── */}
              <TabsContent value="runs" className="mt-4 space-y-4">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-slate-500" />
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Every scheduled and manual FMCSA check run is recorded here for audit and traceability.
                  </p>
                </div>
                <Card>
                  <CardContent className="p-0">
                    {runsLoading ? (
                      <div className="flex items-center justify-center py-16 text-slate-400">
                        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading…
                      </div>
                    ) : integrationRuns.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                        <History className="h-10 w-10" />
                        <p className="text-sm">No runs yet — click "Run Check Now" to start</p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Run ID</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Checked</TableHead>
                            <TableHead>Success</TableHead>
                            <TableHead>Not Found</TableHead>
                            <TableHead>Errors</TableHead>
                            <TableHead>Alerts</TableHead>
                            <TableHead>Duration</TableHead>
                            <TableHead>Started</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {integrationRuns.map(run => {
                            const duration =
                              run.completedAt
                                ? Math.round(
                                    (new Date(run.completedAt).getTime() -
                                      new Date(run.startedAt).getTime()) / 1000,
                                  )
                                : null;
                            return (
                              <TableRow key={run.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                <TableCell>
                                  <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
                                    #{run.id}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <Badge className={cn("text-xs capitalize",
                                    run.runType === "manual"
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-slate-100 text-slate-600"
                                  )}>
                                    {run.runType}
                                  </Badge>
                                </TableCell>
                                <TableCell>{runStatusBadge(run.status)}</TableCell>
                                <TableCell className="text-sm">{run.totalChecked ?? 0}</TableCell>
                                <TableCell>
                                  <span className="text-green-700 font-medium text-sm">{run.successCount ?? 0}</span>
                                </TableCell>
                                <TableCell>
                                  <span className="text-yellow-700 text-sm">{run.notFoundCount ?? 0}</span>
                                </TableCell>
                                <TableCell>
                                  <span className={cn("text-sm", (run.failureCount ?? 0) > 0 ? "text-red-600 font-medium" : "text-slate-400")}>
                                    {run.failureCount ?? 0}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <span className={cn("text-sm", (run.alertsCreated ?? 0) > 0 ? "text-amber-600 font-medium" : "text-slate-400")}>
                                    {run.alertsCreated ?? 0}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <span className="text-xs text-slate-500">
                                    {duration !== null ? `${duration}s` : "—"}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1 text-xs text-slate-500">
                                    <Clock className="h-3.5 w-3.5" />
                                    {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                                    {run.triggeredBy !== "system" && (
                                      <span className="text-slate-400">· {run.triggeredBy}</span>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
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
                              {severityBadge(a.severity)}
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
