import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Mail, RefreshCw, Send, ShieldAlert, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BroadcastClient, BroadcastDetail, BroadcastDraftInput, BroadcastFilters, BroadcastSummary } from "../../../../shared/email-broadcast";

type BroadcastOptions = { statuses: string[]; agents: { id: string; name: string }[] };
type RecipientResponse = { clients: BroadcastClient[]; counts: { matched: number; sendable: number; skipped: number } };

const templates = {
  document: {
    subject: "Documents needed",
    body: "Hello,\n\nCould you please send the following documents when you have a chance?\n\n[Add document names]\n\nThank you,\nTruckingPros Financial",
  },
  deadline: {
    subject: "Deadline reminder",
    body: "Hello,\n\nThis is a reminder to send the outstanding [documents/items] by [agreed deadline]. If you need more time, please reply so we can help.\n\nThank you,\nTruckingPros Financial",
  },
} as const;

const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const newRequestId = () => crypto.randomUUID();
const activeStatus = (status?: string) => status === "queued" || status === "sending";
const statusTone: Record<string, string> = {
  draft: "border-[#d5b77b] bg-[#fff7e7] text-[#866322]",
  queued: "border-[#a8c5ca] bg-[#edf6f7] text-[#326572]",
  sending: "border-[#a8c5ca] bg-[#edf6f7] text-[#326572]",
  completed: "border-[#8bbcaf] bg-[#e6f4ed] text-[#28644f]",
  cancelled: "border-[#c2c9c7] bg-[#f1f3f2] text-[#5b6968]",
  sent: "border-[#8bbcaf] bg-[#e6f4ed] text-[#28644f]",
  failed: "border-[#d1a19a] bg-[#fff0ed] text-[#97473f]",
  skipped: "border-[#d5b77b] bg-[#fff7e7] text-[#866322]",
  pending: "border-[#c2c9c7] bg-[#f1f3f2] text-[#5b6968]",
  unconfirmed: "border-[#d5b77b] bg-[#fff7e7] text-[#866322]",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message || `Request failed (HTTP ${response.status}).`), { status: response.status });
  return result as T;
}

function StatusTag({ value }: { value: string }) {
  return <span className={`inline-flex border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusTone[value] || statusTone.pending}`}>{value}</span>;
}

export function EmailBroadcast() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [assignedProcessor, setAssignedProcessor] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [preview, setPreview] = useState<BroadcastDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [staleMessage, setStaleMessage] = useState("");
  const requestId = useRef(newRequestId());
  const previewGuard = useRef(false);
  const confirmGuard = useRef(false);
  const cancelGuard = useRef(false);
  const filters = useMemo<BroadcastFilters>(() => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status ? { status: status as BroadcastFilters["status"] } : {}),
    ...(assignedProcessor ? { assignedProcessor } : {}),
  }), [search, status, assignedProcessor]);
  const inputSignature = JSON.stringify([filters, subject, body, templateName]);
  const signatureRef = useRef(inputSignature);
  if (signatureRef.current !== inputSignature) {
    signatureRef.current = inputSignature;
    requestId.current = newRequestId();
    setPreview(null);
    setConfirmOpen(false);
    setStaleMessage("");
  }

  const optionsQuery = useQuery<BroadcastOptions>({
    queryKey: ["/api/email-broadcasts/options"],
    queryFn: () => api("/api/email-broadcasts/options"),
  });
  const recipientsQuery = useQuery<RecipientResponse>({
    queryKey: ["/api/email-broadcasts/recipients", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.status) params.set("status", filters.status);
      if (filters.assignedProcessor) params.set("assignedProcessor", filters.assignedProcessor);
      const queryString = params.toString();
      return api(`/api/email-broadcasts/recipients${queryString ? `?${queryString}` : ""}`);
    },
  });
  const historyQuery = useQuery<BroadcastSummary[]>({
    queryKey: ["/api/email-broadcasts"],
    queryFn: () => api("/api/email-broadcasts"),
    refetchInterval: (query) => (query.state.data || []).some((item) => activeStatus(item.status)) ? 2500 : false,
  });
  const detailQuery = useQuery<BroadcastDetail>({
    queryKey: ["/api/email-broadcasts", selectedId],
    enabled: !!selectedId,
    queryFn: () => api(`/api/email-broadcasts/${selectedId}`),
    refetchInterval: (query) => activeStatus(query.state.data?.broadcast.status) ? 2000 : false,
  });

  const previewMutation = useMutation({
    mutationFn: () => {
      const payload: BroadcastDraftInput = {
        requestId: requestId.current,
        subject: subject.trim(),
        body: body.trim(),
        ...(templateName ? { templateName: templateName as "document" | "deadline" } : {}),
        filters,
      };
      return api<BroadcastDetail>("/api/email-broadcasts/preview", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
    },
    onSuccess: (detail) => {
      setPreview(detail);
      setSelectedId(detail.broadcast.id);
      setConfirmOpen(true);
      setStaleMessage("");
      void historyQuery.refetch();
    },
  });
  const confirmMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Create a fresh preview before confirming.");
      return api<BroadcastDetail>(`/api/email-broadcasts/${preview.broadcast.id}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientCount: preview.broadcast.counts.sendable }),
      });
    },
    onSuccess: (detail) => {
      setPreview(detail);
      setSelectedId(detail.broadcast.id);
      setConfirmOpen(false);
      queryClient.setQueryData(["/api/email-broadcasts", detail.broadcast.id], detail);
      void historyQuery.refetch();
    },
    onError: (error: Error & { status?: number }) => {
      if (error.status === 409) {
        requestId.current = newRequestId();
        setPreview(null);
        setConfirmOpen(false);
        setStaleMessage("The recipient list changed after this preview. Your message is retained; preview again to review the current recipients before confirming.");
        void recipientsQuery.refetch();
        void historyQuery.refetch();
      }
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => api<BroadcastDetail>(`/api/email-broadcasts/${id}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }),
    onSuccess: (detail) => {
      setSelectedId(detail.broadcast.id);
      queryClient.setQueryData(["/api/email-broadcasts", detail.broadcast.id], detail);
      void historyQuery.refetch();
    },
  });

  const recipients = recipientsQuery.data;
  const canPreview = !!subject.trim() && !!body.trim() && !previewMutation.isPending && !confirmMutation.isPending && !previewRefreshing;
  const inputsDisabled = previewMutation.isPending || confirmMutation.isPending || previewRefreshing;
  const selectedDetail = detailQuery.data?.broadcast.id === selectedId ? detailQuery.data : preview?.broadcast.id === selectedId ? preview : null;
  const confirmError = confirmMutation.error as (Error & { status?: number }) | null;
  const currentError = previewMutation.error || (confirmError?.status === 409 ? null : confirmError) || cancelMutation.error;
  const beginPreview = async () => {
    if (previewGuard.current || !canPreview) return;
    previewGuard.current = true;
    setPreviewRefreshing(true);
    try {
      const latestAudience = await recipientsQuery.refetch();
      if (latestAudience.error || !latestAudience.data?.counts.sendable) {
        previewGuard.current = false;
        setPreviewRefreshing(false);
        return;
      }
      previewMutation.mutate(undefined, { onSettled: () => {
        previewGuard.current = false;
        setPreviewRefreshing(false);
      } });
    } catch {
      previewGuard.current = false;
      setPreviewRefreshing(false);
    }
  };
  const applyTemplate = (value: string) => {
    setTemplateName(value);
    if (value === "document" || value === "deadline") {
      setSubject(templates[value].subject);
      setBody(templates[value].body);
    } else {
      setSubject("");
      setBody("");
    }
  };
  const statusOptions = optionsQuery.data?.statuses || [];

  return <section className="border border-[#899795] bg-[#edf2ef] shadow-[1px_1px_0_#fff]">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c4cfcb] bg-[#dfe8e4] px-3 py-3">
      <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center border border-[#8fb3ae] bg-[#dcebe6] text-[#087f8e]"><Users className="h-4 w-4" /></div><div><h2 className="text-sm font-bold text-[#263f48]">Client broadcast</h2><p className="text-[10px] text-[#697c7d]">Admin desk · individual client emails</p></div></div>
      <span className="border border-[#c9b77c] bg-[#fff8e9] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#765f30]">Admin only</span>
    </header>
    <div className="grid gap-0 xl:grid-cols-[minmax(0,1.12fr)_minmax(340px,.88fr)]">
      <div className="space-y-4 border-b border-[#c4cfcb] p-3 md:p-4 xl:border-b-0 xl:border-r">
        <div className="flex items-start gap-2 border border-[#d1b579] bg-[#fff8e9] p-2.5 text-[10px] leading-relaxed text-[#765f30]">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Broadcast safety.</strong> Each client gets an individual email through the TPF sender and monitored Reply-To. CC and BCC are never used. Sends are spaced by at least 2 seconds globally (about 30 per minute). “Sent” means provider accepted the message, not that it was delivered.</p>
        </div>
        <div className="space-y-2">
          <div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#758582]">01 / Audience</p><h3 className="text-xs font-bold text-[#304a52]">Choose all clients or narrow the group</h3></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="broadcast-search" className="text-[10px]">Client search</Label><Input id="broadcast-search" value={search} disabled={inputsDisabled} onChange={(e) => setSearch(e.target.value)} maxLength={200} placeholder="Name or email…" className="h-9 rounded-sm bg-white text-xs" /></div>
            <div className="space-y-1"><Label htmlFor="broadcast-status" className="text-[10px]">Client status</Label><Select value={status || "all"} disabled={inputsDisabled} onValueChange={(value) => setStatus(value === "all" ? "" : value)}><SelectTrigger id="broadcast-status" className="h-9 rounded-sm bg-white text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{statusOptions.map((option) => <SelectItem key={option} value={option}>{option.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="broadcast-agent" className="text-[10px]">Assigned processor</Label><Select value={assignedProcessor || "all"} disabled={inputsDisabled} onValueChange={(value) => setAssignedProcessor(value === "all" ? "" : value)}><SelectTrigger id="broadcast-agent" className="h-9 rounded-sm bg-white text-xs"><SelectValue placeholder="All processors" /></SelectTrigger><SelectContent><SelectItem value="all">All processors</SelectItem>{(optionsQuery.data?.agents || []).map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
          {optionsQuery.isLoading ? <div className="h-8 animate-pulse bg-[#dce5e1]" /> : optionsQuery.error ? <div role="alert" className="flex items-center justify-between gap-2 border border-[#d3a49e] bg-[#fff1ee] p-2 text-[10px] text-[#8d433a]"><span>{optionsQuery.error.message}</span><Button size="sm" variant="outline" onClick={() => void optionsQuery.refetch()}>Retry</Button></div> : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-[#c6d0cd] bg-[#f8faf8] px-3 py-2 text-[10px] text-[#536a6d]">
            {recipientsQuery.isLoading ? <span className="h-3 w-36 animate-pulse bg-[#dce5e1]" /> : recipientsQuery.error ? <span className="text-[#8d433a]">{recipientsQuery.error.message}</span> : <>
              <span><strong className="text-[#304a52]">{recipients?.counts.matched ?? 0}</strong> matched</span><span><strong className="text-[#28644f]">{recipients?.counts.sendable ?? 0}</strong> sendable</span><span><strong className="text-[#866322]">{recipients?.counts.skipped ?? 0}</strong> skipped</span>
            </>}
            {recipientsQuery.isFetching && !recipientsQuery.isLoading && <RefreshCw className="h-3 w-3 animate-spin text-[#087f8e]" />}
          </div>
          {recipientsQuery.error && <Button size="sm" variant="outline" onClick={() => void recipientsQuery.refetch()}>Retry recipient list</Button>}
          <div className="max-h-40 overflow-auto border border-[#c6d0cd] bg-[#f8faf8]">
            {recipientsQuery.isLoading ? <div className="space-y-1 p-2"><div className="h-6 animate-pulse bg-[#dce5e1]" /><div className="h-6 animate-pulse bg-[#dce5e1]" /></div>
              : !recipients?.clients.length ? <p className="px-3 py-4 text-center text-[10px] text-[#73817f]">No clients match this audience.</p>
                : recipients.clients.map((client) => <div key={client.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#e0e6e3] px-2.5 py-1.5 last:border-b-0">
                  {client.canSend ? <Check className="h-3 w-3 shrink-0 text-[#398269]" /> : <X className="h-3 w-3 shrink-0 text-[#a6574e]" />}
                  <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#304a52]">{client.name}</span><span className="max-w-[40%] truncate text-[9px] text-[#758582]">{client.email || "No email"}</span>
                  {!client.canSend && <span className="w-full pl-5 text-[9px] text-[#8d433a]">{client.skipReason || "Not eligible to receive email"}</span>}
                </div>)}
          </div>
        </div>
        <div className="space-y-2 border-t border-[#cbd5d1] pt-3">
          <div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#758582]">02 / Message</p><h3 className="text-xs font-bold text-[#304a52]">Write once, delivered separately</h3></div>
          <div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="broadcast-template" className="text-[10px]">Optional template</Label><Select value={templateName || "none"} disabled={inputsDisabled} onValueChange={(value) => applyTemplate(value === "none" ? "" : value)}><SelectTrigger id="broadcast-template" className="h-8 w-full max-w-xs rounded-sm bg-white text-xs"><SelectValue placeholder="Start from a template…" /></SelectTrigger><SelectContent><SelectItem value="none">No template</SelectItem><SelectItem value="document">Document request</SelectItem><SelectItem value="deadline">Deadline reminder</SelectItem></SelectContent></Select></div>
          <p className="text-[10px] text-[#657977]">Starting text only. Replace bracketed details before previewing.</p>
          <div className="space-y-1"><Label htmlFor="broadcast-subject" className="text-[10px]">Subject</Label><Input id="broadcast-subject" value={subject} disabled={inputsDisabled} maxLength={200} onChange={(e) => setSubject(e.target.value)} className="rounded-sm bg-white text-xs" placeholder="A clear, specific subject" /><p className="text-right text-[9px] text-[#84918f]">{subject.length}/200</p></div>
          <div className="space-y-1"><Label htmlFor="broadcast-body" className="text-[10px]">Message</Label><Textarea id="broadcast-body" value={body} disabled={inputsDisabled} maxLength={20000} rows={7} onChange={(e) => setBody(e.target.value)} className="resize-y rounded-sm bg-white text-xs leading-relaxed" placeholder="Write your message…" /><p className="text-right text-[9px] text-[#84918f]">{body.length}/20,000</p></div>
          <p className="text-[10px] text-[#657977]">TPF branding and monitored Reply-To are applied by the server sender. No recipient is exposed to another.</p>
          {staleMessage && <div role="alert" className="border border-[#d5b77b] bg-[#fff7e7] p-2.5 text-[10px] leading-relaxed text-[#765f30]">{staleMessage}</div>}
          {currentError && <div role="alert" className="border border-[#d3a49e] bg-[#fff1ee] p-2.5 text-[10px] leading-relaxed text-[#8d433a]"><strong>Draft retained.</strong> {currentError.message}</div>}
          <Button type="button" disabled={!canPreview || recipientsQuery.isLoading || recipientsQuery.isError || !recipients?.counts.sendable} onClick={() => void beginPreview()} className="h-9 w-full rounded-sm bg-[#087f8e] text-xs font-bold text-white hover:bg-[#076c78]">
            <Send className="mr-2 h-3.5 w-3.5" />{previewRefreshing ? "Refreshing audience…" : previewMutation.isPending ? "Preparing preview…" : "Preview broadcast"}
          </Button>
        </div>
      </div>

      <div className="min-w-0 p-3 md:p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#758582]">03 / Activity</p><h3 className="text-xs font-bold text-[#304a52]">Broadcast history</h3></div><Button size="sm" variant="outline" className="h-7 rounded-sm px-2 text-[10px]" onClick={() => void historyQuery.refetch()} disabled={historyQuery.isFetching}><RefreshCw className={`mr-1.5 h-3 w-3 ${historyQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>
        {historyQuery.isLoading ? <div className="space-y-2"><div className="h-12 animate-pulse bg-[#dce5e1]" /><div className="h-12 animate-pulse bg-[#dce5e1]" /></div>
          : historyQuery.error ? <div role="alert" className="flex items-center justify-between gap-2 border border-[#d3a49e] bg-[#fff1ee] p-3 text-[10px] text-[#8d433a]"><span>{historyQuery.error.message}</span><Button size="sm" variant="outline" onClick={() => void historyQuery.refetch()}>Retry</Button></div>
            : !historyQuery.data?.length ? <div className="border border-dashed border-[#bdc9c5] bg-[#f6f8f6] px-4 py-8 text-center"><Mail className="mx-auto mb-2 h-5 w-5 text-[#849794]" /><p className="text-xs font-semibold text-[#536a6d]">No broadcasts yet</p><p className="mt-1 text-[10px] text-[#7b8b89]">A broadcast only starts after a fresh preview and a separate confirmation.</p></div>
              : <div className="max-h-64 space-y-1 overflow-auto">
                {historyQuery.data.map((item) => <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); setConfirmOpen(false); }} className={`flex w-full items-center gap-2 border px-2.5 py-2 text-left ${item.id === selectedId ? "border-[#6eaaa4] bg-[#e8f3ef]" : "border-[#c6d0cd] bg-[#f8faf8] hover:bg-[#eff6f3]"}`}>
                  <StatusTag value={item.status} /><span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#304a52]">{item.subject || "(No subject)"}</span><span className="hidden text-[9px] text-[#73817f] sm:inline">{item.counts.sent}/{item.counts.total}</span><span className="text-[9px] text-[#73817f]">{dateTime(item.createdAt)}</span>
                </button>)}
              </div>}
        {selectedId && detailQuery.isLoading && <div className="mt-3 space-y-2 border border-[#c6d0cd] bg-[#f8faf8] p-3" aria-label="Loading broadcast details"><div className="h-6 animate-pulse bg-[#dce5e1]" /><div className="h-20 animate-pulse bg-[#dce5e1]" /></div>}
        {selectedId && detailQuery.error && <div role="alert" className="mt-3 flex items-center justify-between gap-2 border border-[#d3a49e] bg-[#fff1ee] p-3 text-[10px] text-[#8d433a]"><span>{detailQuery.error.message}</span><Button size="sm" variant="outline" onClick={() => void detailQuery.refetch()}>Retry details</Button></div>}
        {selectedDetail && <div className="mt-3 border border-[#9aa7a5] bg-[#f8faf8]">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#c4cfcb] bg-[#e7eeeb] px-3 py-2"><div className="flex items-center gap-2"><h4 className="text-[11px] font-bold text-[#304a52]">Selected broadcast</h4><StatusTag value={selectedDetail.broadcast.status} /></div>{activeStatus(selectedDetail.broadcast.status) && <Button size="sm" variant="outline" disabled={cancelMutation.isPending} onClick={() => { if (cancelGuard.current) return; cancelGuard.current = true; cancelMutation.mutate(selectedDetail.broadcast.id, { onSettled: () => { cancelGuard.current = false; } }); }} className="h-7 rounded-sm px-2 text-[10px]"><X className="mr-1 h-3 w-3" />{cancelMutation.isPending ? "Stopping…" : "Cancel queued sends"}</Button>}</header>
          <div className="grid grid-cols-2 gap-px border-b border-[#d3dcda] bg-[#d3dcda] sm:grid-cols-3">
            {(["total", "sendable", "skipped", "sent", "failed", "unconfirmed", "pending"] as const).map((key) => <div key={key} className="bg-[#f3f7f4] px-2.5 py-2"><p className="text-[8px] font-bold uppercase tracking-wider text-[#7a8986]">{key}</p><p className="font-mono text-sm font-bold text-[#304a52]">{selectedDetail.broadcast.counts[key]}</p></div>)}
          </div>
          <div className="space-y-2 p-3">
            <p className="text-[10px] text-[#647876]">Created by {selectedDetail.broadcast.createdByName || selectedDetail.broadcast.createdBy} · {dateTime(selectedDetail.broadcast.createdAt)}{selectedDetail.broadcast.confirmedAt ? ` · confirmed ${dateTime(selectedDetail.broadcast.confirmedAt)}` : ""}</p>
            {selectedDetail.broadcast.body && <div><p className="mb-1 text-[8px] font-bold uppercase tracking-wider text-[#7a8986]">Message</p><div className="max-h-32 overflow-auto whitespace-pre-wrap border border-[#d6dfdc] bg-white p-2.5 text-[10px] leading-relaxed text-[#34494c]"><strong>{selectedDetail.broadcast.subject}</strong>{"\n\n"}{selectedDetail.broadcast.body}</div></div>}
            <div className="overflow-x-auto border border-[#d6dfdc]">
              <table className="w-full min-w-[470px] text-left text-[9px]">
                <thead className="bg-[#e7eeeb] text-[#657977]"><tr><th className="px-2 py-1.5 font-bold uppercase tracking-wide">Client / recipient</th><th className="px-2 py-1.5 font-bold uppercase tracking-wide">Status</th><th className="px-2 py-1.5 font-bold uppercase tracking-wide">Time / reason</th></tr></thead>
                <tbody>{selectedDetail.recipients.map((recipient) => <tr key={recipient.id} className="border-t border-[#e0e6e3] align-top"><td className="px-2 py-1.5"><p className="font-semibold text-[#304a52]">{recipient.clientName}</p><p className="break-all text-[#758582]">{recipient.email || "No email"}</p></td><td className="px-2 py-1.5"><StatusTag value={recipient.status} /></td><td className="max-w-[220px] break-words px-2 py-1.5 text-[#657977]">{recipient.sentAt ? dateTime(recipient.sentAt) : recipient.error || "—"}{recipient.sentAt && recipient.error ? <span className="block text-[#8d433a]">{recipient.error}</span> : null}</td></tr>)}</tbody>
              </table>
            </div>
            {detailQuery.isFetching && activeStatus(selectedDetail.broadcast.status) && <p className="flex items-center gap-1.5 text-[9px] text-[#657977]"><RefreshCw className="h-3 w-3 animate-spin" />Updating job progress…</p>}
          </div>
        </div>}
      </div>
    </div>

    {preview && <Dialog open={confirmOpen} onOpenChange={(value) => { if (!confirmMutation.isPending) setConfirmOpen(value); }}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto rounded-sm border-2 border-[#7c8582] bg-[#e8eeeb] p-0 shadow-[4px_4px_0_rgba(39,54,56,.25)]">
        <DialogHeader className="border-b border-[#b8c3bf] bg-[#d6e2de] px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm font-bold text-[#203a46]"><AlertCircle className="h-4 w-4 text-[#a26e27]" />Confirm broadcast</DialogTitle>
          <DialogDescription className="mt-1 text-[10px] text-[#596d70]">This is the final review. Confirmation queues individual client emails.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2"><div className="border border-[#b7cfca] bg-[#f1f7f4] p-2"><p className="text-[9px] font-bold uppercase tracking-wide text-[#657977]">Sendable</p><p className="font-mono text-xl font-bold text-[#28644f]">{preview.broadcast.counts.sendable}</p></div><div className="border border-[#d6b076] bg-[#fff8e9] p-2"><p className="text-[9px] font-bold uppercase tracking-wide text-[#765f30]">Skipped</p><p className="font-mono text-xl font-bold text-[#866322]">{preview.broadcast.counts.skipped}</p></div></div>
          <div className="border border-[#c6d0cd] bg-white p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-[#758582]">Subject</p><p className="mt-1 break-words text-xs font-bold text-[#304a52]">{preview.broadcast.subject}</p><p className="mt-3 text-[9px] font-bold uppercase tracking-wide text-[#758582]">Body preview</p><p className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#34494c]">{preview.broadcast.body}</p></div>
          <div className="max-h-32 overflow-auto border border-[#d6b076] bg-[#fff8e9] p-2.5 text-[10px] text-[#765f30]"><p className="mb-1 font-bold">Skipped recipients and reasons</p>{preview.recipients.filter((recipient) => recipient.status === "skipped" || recipient.error).length ? preview.recipients.filter((recipient) => recipient.status === "skipped" || recipient.error).map((recipient) => <p key={recipient.id} className="border-t border-[#ead8b1] py-1">{recipient.clientName}: {recipient.error || "Not eligible to receive email"}</p>) : <p>None. All matched clients can receive this message.</p>}</div>
          <p className="text-[10px] leading-relaxed text-[#596d70]">Confirm exactly <strong>{preview.broadcast.counts.sendable}</strong> sendable recipients. The server rechecks audience and preview expiry before queueing. Broadcasts cannot be CC’d or BCC’d.</p>
          {confirmError && confirmError.status !== 409 && <div role="alert" className="border border-[#d3a49e] bg-[#fff1ee] p-2 text-[10px] text-[#8d433a]">Confirmation failed; your draft is retained. {confirmError.message}</div>}
        </div>
        <DialogFooter className="flex flex-wrap justify-end gap-2 border-t border-[#c5cfcc] bg-[#e1e8e5] px-4 py-3">
          <Button type="button" variant="outline" className="h-8 rounded-sm text-xs" disabled={confirmMutation.isPending} onClick={() => setConfirmOpen(false)}>Review message</Button>
          <Button type="button" className="h-8 rounded-sm bg-[#087f8e] text-xs text-white hover:bg-[#076c78]" disabled={confirmMutation.isPending || preview.broadcast.counts.sendable < 1} onClick={() => { if (confirmGuard.current) return; confirmGuard.current = true; confirmMutation.mutate(undefined, { onSettled: () => { confirmGuard.current = false; } }); }}><Check className="mr-1.5 h-3.5 w-3.5" />{confirmMutation.isPending ? "Confirming…" : `Confirm ${preview.broadcast.counts.sendable} emails`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
  </section>;
}
