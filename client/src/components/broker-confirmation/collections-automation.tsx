import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { Link } from "wouter";
import { format } from "date-fns";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Clock3, FileText, Pause, Play, RefreshCw, Search, ShieldAlert, StopCircle, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { CollectionRunFailure, runBrokerCollections } from "@/lib/brokerCollections";
import { RecoveryBadge, RecoveryButton as Button, RecoveryCard as Card, RecoveryInput as Input, RecoverySelect as Select, RecoveryDialogContent as DialogContent, RecoveryTable } from "@/components/recovery/recovery-controls";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NeuNotice } from "@/components/shared/NeuNotice";
import type { CollectionRow as QueueRow, CollectionEvent, CollectionQueue as QueueResponse,
  CollectionDetail as DetailResponse, CollectionSettings as Settings, CollectionRunResult } from "@shared/broker-collections";

type Phase = "vp" | "rps" | "paid" | "stopped" | "escalated" | "paused";
type PendingConfirmation = { kind: "global-live" } | { kind: "invoice"; invoiceId: number; action: "paid" | "stop" | "start_live" };

const phases: { value: Phase | "all"; label: string }[] = [
  { value: "all", label: "All collections" }, { value: "vp", label: "Awaiting VP" },
  { value: "rps", label: "Awaiting payment" }, { value: "escalated", label: "Escalated" },
  { value: "paused", label: "Paused" }, { value: "paid", label: "Workflow paid" },
  { value: "stopped", label: "Stopped" },
];

function dateLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "MMM d, yyyy · h:mm a");
}

function phaseLabel(row: QueueRow) {
  if (row.paused && row.phase !== "paid" && row.phase !== "stopped") return row.lastError ? "Error · paused" : "Paused";
  if (row.escalatedPhase) return `Escalated · ${row.escalatedPhase.toUpperCase()}`;
  return ({ vp: "Awaiting VP", rps: "Awaiting payment", paid: "Workflow paid", stopped: "Stopped" } as const)[row.phase];
}

function outcomeLabel(event: CollectionEvent) {
  const value = event.outcome.toLowerCase();
  if (event.mode === "dry_run" || value.includes("would_") || value.includes("simulat")) return "SIMULATED";
  return event.outcome.replaceAll("_", " ");
}

export default function CollectionsAutomation() {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase | "all">("all");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [runResult, setRunResult] = useState<CollectionRunResult | null>(null);
  const pageSize = DEFAULT_PAGE_SIZE;
  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (phase !== "all") p.set("phase", phase);
    if (query.trim()) p.set("q", query.trim());
    return p.toString();
  }, [page, phase, query]);
  const queue = useQuery<QueueResponse>({
    queryKey: ["/api/broker-collections", params],
    queryFn: async () => (await apiRequest("GET", `/api/broker-collections?${params}`)).json(),
    staleTime: 0, refetchOnMount: "always", refetchInterval: 30000,
  });
  const settings = useQuery<Settings>({
    queryKey: ["/api/broker-collections/settings"],
    queryFn: async () => (await apiRequest("GET", "/api/broker-collections/settings")).json(),
    staleTime: 0, refetchOnMount: "always", refetchInterval: 30000,
  });
  const detail = useQuery<DetailResponse>({
    queryKey: ["/api/broker-collections", selectedId],
    enabled: selectedId !== null,
    queryFn: async () => (await apiRequest("GET", `/api/broker-collections/${selectedId}`)).json(),
    staleTime: 0,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["/api/broker-collections"] });
    qc.invalidateQueries({ queryKey: ["/api/broker-collections/settings"] });
  };
  const actionMutation = useMutation({
    mutationFn: ({ invoiceId, action, confirmLive }: { invoiceId: number; action: "vp_confirmed" | "paid" | "pause" | "resume" | "stop" | "start_live"; confirmLive?: true }) =>
      apiRequest("POST", `/api/broker-collections/${invoiceId}/action`, { action, ...(confirmLive ? { confirmLive: true } : {}) }),
    onSuccess: () => { refresh(); if (selectedId !== null) qc.invalidateQueries({ queryKey: ["/api/broker-collections", selectedId] }); setPending(null); setErrorMessage(""); },
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : "Action could not be completed."),
  });
  const settingsMutation = useMutation({
    mutationFn: (value: { enabled: boolean; mode: "dry_run" | "live"; confirmLive?: true }) =>
      apiRequest("PATCH", "/api/broker-collections/settings", value),
    onSuccess: () => { refresh(); setPending(null); setErrorMessage(""); },
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : "Settings could not be saved."),
  });
  const runMutation = useMutation({
    mutationFn: runBrokerCollections,
    retry: false,
    onMutate: () => { setRunResult(null); setErrorMessage(""); },
    onSuccess: setRunResult,
    onError: (error) => {
      if (error instanceof CollectionRunFailure) setRunResult(error.result);
      else setErrorMessage(error instanceof Error ? error.message : "Automation run failed.");
    },
    // A failed run may have paused invoices or partially completed other work.
    onSettled: refresh,
  });
  const currentSettings = settings.data ?? queue.data?.settings;
  const rows = queue.data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((queue.data?.total ?? 0) / pageSize));

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(searchInput);
  }
  function requestAction(invoiceId: number, action: "paid" | "stop" | "start_live") {
    setPending({ kind: "invoice", invoiceId, action });
  }
  function confirmPending() {
    if (!pending) return;
    if (pending.kind === "global-live") {
      settingsMutation.mutate({ enabled: true, mode: "live", confirmLive: true });
    } else {
      actionMutation.mutate({ invoiceId: pending.invoiceId, action: pending.action, ...(pending.action === "start_live" ? { confirmLive: true as const } : {}) });
    }
  }

  return (
    <section className="space-y-3" data-testid="collections-automation">
      <Card className="overflow-hidden rounded-2xl border-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#c9c9c9] px-4 py-3">
          <FileText className="h-4 w-4 text-[#087f8c]" />
          <div><h2 className="font-bold text-[#222]">Broker collections · VP / RPS</h2><p className="text-[11px] text-[#555]">Verify paperwork receipt, then track payment status.</p></div>
          <Button size="sm" variant="outline" className="ml-auto h-7 px-2" onClick={() => { queue.refetch(); settings.refetch(); }}><RefreshCw className="mr-1 h-3 w-3" />Refresh</Button>
        </div>

        {currentSettings?.liveEmailsBlocked && <NeuNotice severity="block" role="alert" data-testid="collections-preview-warning" className="text-xs">
          <strong>{currentSettings.liveEmailNotice}</strong>
          <p className="mt-1">Saving LIVE does not bypass this safeguard. Dry-run tests work here; a real email test must run in the published production app using a broker email address you control.</p>
        </NeuNotice>}
        {currentSettings && <div className="grid gap-3 border-b border-[#c9c9c9] p-3 md:grid-cols-[1fr_auto] md:items-center">
          <div className="flex items-start gap-2 text-xs text-[#45433e]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#8b5a00]" />
            <div><strong>{currentSettings.enabled ? "Automation is on" : "Global automation is off."}</strong>{" "}
              {currentSettings.enabled
                ? "New enrollment uses the selected mode. Existing simulations stay simulated until explicitly started live. Dry-run mode also blocks existing live workflows."
                : "All automatic schedules—including legacy schedules—are stopped. Manual sends remain manual. Timers catch up when the app is awake."}
              <div className="mt-1 text-[10px] text-[#666]">Dry run never sends broker email or real bell notices; it records would-send / would-notify events. SIMULATED is not sent.</div>
            </div>
          </div>
          {currentSettings.canManage && <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-bold text-[#333]"><input type="checkbox" checked={currentSettings.enabled} disabled={settingsMutation.isPending} onChange={e => {
              if (e.target.checked && currentSettings.mode === "live") setPending({ kind: "global-live" });
              else settingsMutation.mutate({ enabled: e.target.checked, mode: currentSettings.mode });
            }} /> Enabled</label>
            <Select aria-label="Global automation mode" className="h-8 min-w-[120px] px-2 text-xs" value={currentSettings.mode} disabled={settingsMutation.isPending} onChange={e => {
              const mode = e.target.value as Settings["mode"];
              if (mode === "live" && currentSettings.enabled) setPending({ kind: "global-live" });
              else settingsMutation.mutate({ enabled: currentSettings.enabled, mode });
            }}><option value="dry_run">Dry run</option><option value="live">Live</option></Select>
            <Button size="sm" variant="outline" className="h-8" disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>{runMutation.isPending ? "Running…" : "Run now"}</Button>
          </div>}
        </div>}

        {runResult && <NeuNotice severity={runResult.failed ? "block" : "info"} role={runResult.failed ? "alert" : "status"} data-testid="collections-run-result" className="text-xs">
          <div className="flex items-start justify-between gap-2"><strong>{runResult.message}</strong><Button variant="ghost" size="icon" aria-label="Dismiss run result" onClick={() => setRunResult(null)}><X className="h-3.5 w-3.5" /></Button></div>
          <p className="mt-1">{runResult.checked} checked · {runResult.processed} successful actions · {runResult.failed} failed. “Accepted” means accepted by the email provider, not confirmed delivered.</p>
          {runResult.errors.length > 0 && <ul className="mt-2 max-h-56 list-disc space-y-2 overflow-y-auto pl-4">{runResult.errors.map((error, i) => <li key={`${error.invoiceId}-${i}`}>
            <strong>{error.invoiceNumber ?? `Invoice ${error.invoiceId}`} — {error.outcome === "unconfirmed" ? "Delivery unconfirmed" : "Failed"}{error.step ? ` (${error.step})` : ""}: </strong>{error.message}
            {error.outcome === "unconfirmed" && <span> Delivery may have been accepted. Resume the existing workflow to retry safely; do not start a new email.</span>}
            <Button variant="link" size="sm" className="ml-2 h-auto p-0 align-baseline" onClick={() => setSelectedId(error.invoiceId)}>View audit</Button>
          </li>)}</ul>}
        </NeuNotice>}
        {errorMessage && <NeuNotice severity="block" role="alert" className="flex items-center justify-between gap-2 text-xs"><span>{errorMessage}</span><Button variant="ghost" size="icon" aria-label="Dismiss notice" onClick={() => setErrorMessage("")}><X className="h-3.5 w-3.5" /></Button></NeuNotice>}
        <div className="flex flex-col gap-3 border-b border-[#c9c9c9] p-3 md:flex-row md:items-center">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter collection phase">
            {phases.map(item => <Button key={item.value} size="sm" variant={phase === item.value ? "accent" : "outline"} onClick={() => { setPhase(item.value); setPage(1); }} className="h-8 px-2 text-[11px] font-bold">{item.label}</Button>)}
          </div>
          <form onSubmit={submitSearch} className="flex gap-1 md:ml-auto">
            <label className="sr-only" htmlFor="collections-search">Search broker, invoice, or load</label>
            <div className="relative min-w-0"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-[#666]" /><Input id="collections-search" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Broker, invoice, load…" className="h-8 w-full pl-7 pr-2 text-xs md:w-56" /></div>
            <Button size="sm" variant="accent" className="h-8" type="submit">Search</Button>
          </form>
        </div>

        {queue.isLoading ? <div className="space-y-2 p-4" aria-label="Loading collection queue">{[0, 1, 2, 3].map(n => <div key={n} className="h-16 animate-pulse rounded-xl bg-[#d2d2d2]" />)}</div>
          : queue.error ? <NeuNotice severity="block" role="alert" className="text-sm"><AlertCircle className="mr-1 inline h-4 w-4" />{(queue.error as Error).message}<Button className="ml-2 h-7" size="sm" onClick={() => queue.refetch()}>Retry</Button></NeuNotice>
          : !rows.length ? <div className="p-9 text-center"><div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#e0e0e0] shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]"><Clock3 className="h-5 w-5 text-[#168d99]" /></div><p className="text-sm font-bold text-[#333]">No collections in this view</p><p className="mt-1 text-xs text-[#666]">Try another phase or search term. No records have been added here.</p></div>
          : <div className="overflow-x-auto">
            <RecoveryTable className="w-full min-w-[1040px] border-collapse text-left text-xs">
              <thead className="text-[#333]"><tr>{["Invoice / broker", "Phase", "Next scheduled", "Attempts · VP / RPS", "Controls", ""].map((h, i) => <th key={i} className="border-b border-[#c9c9c9] px-3 py-2 font-bold">{h}</th>)}</tr></thead>
              <tbody>{rows.map(row => <tr key={row.invoiceId} className="border-b border-[#d0d0d0] hover:bg-[#dceaea]">
                <td className="px-3 py-2.5"><Link href={`/invoices/${row.invoiceId}`} className="font-bold text-[#087f8c] underline">{row.invoiceNumber}</Link><div className="mt-0.5 text-[#333]">{row.broker || "Broker not listed"}</div><div className="text-[10px] text-[#666]">Load {row.loadNumber || "—"} · Carrier {row.carrier || "—"}</div></td>
                 <td className="px-3 py-2.5"><RecoveryBadge tone={row.phase === "paid" ? "success" : row.escalatedPhase || row.lastError ? "warning" : "neutral"} className="px-2 py-1 text-[10px]">{phaseLabel(row)}</RecoveryBadge><div className="mt-1 text-[10px] font-bold uppercase text-[#666]">{row.mode === "dry_run" ? "SIMULATED" : "LIVE"}{row.paused ? " · paused" : ""}</div>{row.lastError && <div className="mt-1 max-w-64 whitespace-normal break-words text-[10px] text-[#a12b22]">Error: {row.lastError}</div>}</td>
                <td className="px-3 py-2.5 text-[#333]">{dateLabel(row.nextActionAt)}</td>
                <td className="px-3 py-2.5 font-mono text-[#333]">{row.vpAttempts} VP <span className="text-[#888]">/</span> {row.rpsAttempts} RPS{row.escalatedPhase && <div className="mt-1 font-sans text-[10px] font-bold text-[#8c271e]">Escalated to Alan</div>}</td>
                <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">
                  {row.phase === "vp" && !row.paused && <Button size="sm" className="h-7 px-2 text-[10px]" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ invoiceId: row.invoiceId, action: "vp_confirmed" })}><Check className="mr-1 h-3 w-3" />VP confirmed</Button>}
                  {(row.phase === "vp" || row.phase === "rps") && <Button size="sm" className="h-7 px-2 text-[10px]" disabled={actionMutation.isPending} onClick={() => requestAction(row.invoiceId, "paid")}><Check className="mr-1 h-3 w-3" />Paid</Button>}
                  {["vp", "rps"].includes(row.phase) && (row.paused
                    ? <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ invoiceId: row.invoiceId, action: "resume" })}><Play className="mr-1 h-3 w-3" />Resume</Button>
                    : <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ invoiceId: row.invoiceId, action: "pause" })}><Pause className="mr-1 h-3 w-3" />Pause</Button>)}
                  {row.phase !== "paid" && row.phase !== "stopped" && <Button size="sm" variant="destructive" className="h-7 px-2 text-[10px]" disabled={actionMutation.isPending} onClick={() => requestAction(row.invoiceId, "stop")}><StopCircle className="mr-1 h-3 w-3" />Stop</Button>}
                  {row.canManage && row.mode === "dry_run" && row.phase !== "paid" && row.phase !== "stopped" && <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => requestAction(row.invoiceId, "start_live")}>Start live…</Button>}
                </div></td>
                <td className="px-3 py-2.5"><Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => setSelectedId(row.invoiceId)}>Audit</Button></td>
              </tr>)}</tbody>
            </RecoveryTable>
          </div>}
        {!queue.isLoading && !queue.error && <div className="flex items-center justify-between border-t border-[#c9c9c9] px-3 py-2 text-[11px] text-[#666]"><span>{queue.data?.total ?? 0} collection records · page {page} of {totalPages}</span><div className="flex gap-1"><Button variant="outline" size="sm" className="h-7 px-2" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft className="h-3 w-3" />Previous</Button><Button variant="outline" size="sm" className="h-7 px-2" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next<ChevronRight className="h-3 w-3" /></Button></div></div>}
      </Card>

      <Dialog open={selectedId !== null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto rounded-2xl border-0 bg-[#e0e0e0] text-[#333] shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8] sm:max-w-3xl">
          <DialogHeader><DialogTitle>Collection audit · {detail.data?.row.invoiceNumber ?? `Invoice ${selectedId ?? ""}`}</DialogTitle></DialogHeader>
          {detail.isLoading || (!detail.data && !detail.error) ? <div className="space-y-2 py-3">{[0, 1, 2].map(n => <div key={n} className="h-12 animate-pulse bg-[#e5e2da]" />)}</div>
            : detail.error ? <NeuNotice severity="block" role="alert" className="text-sm">{(detail.error as Error).message}<Button variant="ghost" className="ml-2" size="sm" onClick={() => detail.refetch()}>Retry</Button></NeuNotice>
            : <div className="space-y-3">
               <div className="rounded-xl bg-[#e0e0e0] p-3 text-xs text-[#444] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]"><strong>{detail.data?.row.broker || "Broker not listed"}</strong> · {phaseLabel(detail.data!.row)} · {detail.data?.row.mode === "dry_run" ? "SIMULATED (not sent)" : "LIVE"}<div className="mt-1">VP confirmed: {dateLabel(detail.data?.row.vpConfirmedAt ?? null)} · Workflow paid: {dateLabel(detail.data?.row.paidAt ?? null)}</div></div>
              {!detail.data?.events.length ? <p className="py-4 text-center text-xs text-[#666]">No audit events recorded.</p>
                 : <div className="space-y-2">{detail.data.events.map(event => <article key={event.id} className="rounded-xl bg-[#e0e0e0] p-3 text-xs shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]">
                  <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-[#333]">{event.step} · {event.phase.toUpperCase()}</strong><RecoveryBadge tone={event.mode === "dry_run" || outcomeLabel(event) === "SIMULATED" ? "warning" : "neutral"} className="px-2 py-1 text-[10px] uppercase">{outcomeLabel(event)}</RecoveryBadge></div>
                  <div className="mt-1 text-[#555]">Occurred {dateLabel(event.occurredAt)}{event.scheduledAt && ` · Scheduled ${dateLabel(event.scheduledAt)}`}{event.recipient && ` · To ${event.recipient}`}</div>
                  {event.providerMessageId && <div className="mt-1 font-mono text-[10px] text-[#555]">Provider ID: {event.providerMessageId}</div>}
                  {event.error && <div className="mt-1 text-[#a12b22]">Error: {event.error}</div>}
                   {event.details !== null && event.details !== undefined && <details className="mt-2"><summary className="cursor-pointer font-bold text-[#168d99]">Event details</summary><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[#e0e0e0] p-2 font-mono text-[10px] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]">{typeof event.details === "string" ? event.details : JSON.stringify(event.details, null, 2)}</pre></details>}
                </article>)}</div>}
            </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={pending !== null} onOpenChange={open => { if (!open && !actionMutation.isPending && !settingsMutation.isPending) setPending(null); }}>
        <DialogContent className="rounded-2xl border-0 bg-[#e0e0e0] text-[#333] shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8] sm:max-w-lg">
          <DialogHeader><DialogTitle>{pending?.kind === "global-live" ? "Enable live broker automation?" : pending?.action === "paid" ? "Mark collection workflow paid?" : pending?.action === "stop" ? "Stop this collection workflow?" : "Start this invoice live?"}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm text-[#3e3b35]">
            {pending?.kind === "global-live" && <p>This enables real automated broker emails for new enrollment. Global mode applies to new enrollment only and does not convert existing simulated invoices to live. Dry-run bell notices are logged only; live mode may create real notifications.</p>}
            {currentSettings?.liveEmailsBlocked && (pending?.kind === "global-live" || (pending?.kind === "invoice" && pending.action === "start_live")) && <NeuNotice severity="block" role="alert">{currentSettings.liveEmailNotice}</NeuNotice>}
            {pending?.kind === "invoice" && pending.action === "start_live" && <p>This explicitly resets this selected invoice from simulation into live scheduling. It may send real broker emails and create real escalation notices. Other simulated invoices remain simulated.</p>}
            {pending?.kind === "invoice" && pending.action === "paid" && <p>This marks the COLLECTION WORKFLOW paid and stops RPS reminders. It does not reconcile cash, change invoice financial status, or update the financial ledger.</p>}
            {pending?.kind === "invoice" && pending.action === "stop" && <p>This permanently stops automation for this invoice. This action is irreversible. Manual broker contact remains available outside this workflow.</p>}
            <div className="flex justify-end gap-2 pt-1"><Button variant="outline" onClick={() => setPending(null)} disabled={actionMutation.isPending || settingsMutation.isPending}>Cancel</Button><Button onClick={confirmPending} disabled={actionMutation.isPending || settingsMutation.isPending}>{actionMutation.isPending || settingsMutation.isPending ? "Applying…" : "Confirm"}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      {settings.isError && <NeuNotice severity="block" role="alert" className="text-xs">Global settings unavailable: {(settings.error as Error).message} <Button variant="link" size="sm" className="h-auto p-0 underline" onClick={() => settings.refetch()}>Retry</Button></NeuNotice>}
    </section>
  );
}
