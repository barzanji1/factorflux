import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Mail, RefreshCw, Send, ShieldAlert, Users, X, CalendarClock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmailTemplatePicker } from "@/components/client-email/email-template-picker";
import { BUILT_IN_EMAIL_TEMPLATES, type EmailTemplate } from "../../../../shared/email-templates";
import type { BroadcastClient, BroadcastDetail, BroadcastDraftInput, BroadcastFilters, BroadcastSummary } from "../../../../shared/email-broadcast";
import { federalHolidays, isoToLocalDateTime, localDateTimeToIso } from "../../../../shared/holiday-scheduling";
import { HolidayYearPlanner } from "@/components/client-email/holiday-year-planner";
import { ScheduledBroadcasts, type ScheduledBroadcast } from "@/components/client-email/scheduled-broadcasts";
import { NeuBadge, NeuButton as Button, NeuInput as Input, NeuTextarea as Textarea } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";

type BroadcastOptions = { statuses: string[]; agents: { id: string; name: string }[] };
type RecipientResponse = { clients: BroadcastClient[]; counts: { matched: number; sendable: number; skipped: number } };
type DraftInputWithSchedule = Omit<BroadcastDraftInput, "scheduleTimeZone"> & { scheduledAt?: string | null; scheduleTimeZone?: string };
type EditingDraft = { id: string; revision: number; clientIds?: number[] };

const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const newRequestId = () => crypto.randomUUID();
const activeStatus = (status?: string) => status === "queued" || status === "sending" || status === "scheduled";
const scheduledLabel = (value: string, zone: string) => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short", timeZone: zone }).format(new Date(value));
  } catch {
    return `${value} · ${zone}`;
  }
};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message || `Request failed (HTTP ${response.status}).`), { status: response.status });
  return result as T;
}

function StatusTag({ value }: { value: string }) {
  const tone = value === "sent" || value === "completed" ? "success" : value === "failed" ? "warning" : value === "scheduled" || value === "queued" || value === "sending" ? "accent" : "neutral";
  return <NeuBadge tone={tone} className={`px-2 py-0.5 text-[9px] uppercase tracking-wide ${value === "failed" ? "text-[#a3483e]" : ""}`}>{value}</NeuBadge>;
}

export function EmailBroadcast() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [assignedProcessor, setAssignedProcessor] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [scheduleDateTime, setScheduleDateTime] = useState("");
  const [scheduleTimeZone, setScheduleTimeZone] = useState("America/Denver");
  const [editingDraft, setEditingDraft] = useState<EditingDraft | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
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
  const inputSignature = JSON.stringify([filters, subject, body, templateName, scheduleDateTime, scheduleTimeZone, editingDraft?.id]);
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
  const scheduledQuery = useQuery<ScheduledBroadcast[]>({
    queryKey: ["/api/email-broadcasts/scheduled"],
    queryFn: () => api("/api/email-broadcasts/scheduled"),
    refetchInterval: 15000,
  });
  const detailQuery = useQuery<BroadcastDetail>({
    queryKey: ["/api/email-broadcasts", selectedId],
    enabled: !!selectedId,
    queryFn: () => api(`/api/email-broadcasts/${selectedId}`),
    refetchInterval: (query) => activeStatus(query.state.data?.broadcast.status) ? 2000 : false,
  });

  const previewMutation = useMutation({
    mutationFn: () => {
      const payload: DraftInputWithSchedule = {
        requestId: requestId.current,
        subject: subject.trim(),
        body: body.trim(),
        ...(templateName ? { templateName: templateName as BroadcastDraftInput["templateName"] } : {}),
        filters,
        ...(editingDraft?.clientIds?.length ? { clientIds: editingDraft.clientIds } : {}),
        ...(scheduleDateTime ? { scheduledAt: localDateTimeToIso(scheduleDateTime, scheduleTimeZone), scheduleTimeZone } : {}),
      };
      const path = editingDraft ? `/api/email-broadcasts/${editingDraft.id}/edit-preview` : "/api/email-broadcasts/preview";
      return api<BroadcastDetail>(path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingDraft ? { ...payload, expectedRevision: editingDraft.revision } : payload),
      });
    },
    onSuccess: (detail) => {
      setPreview(detail);
      setSelectedId(detail.broadcast.id);
      queryClient.setQueryData(["/api/email-broadcasts", detail.broadcast.id], detail);
      setConfirmOpen(true);
      setStaleMessage("");
      if (editingDraft) {
        setEditingDraft((current) => current ? {
          ...current,
          revision: (detail.broadcast as ScheduledBroadcast).revision,
        } : current);
      }
      void historyQuery.refetch();
      void scheduledQuery.refetch();
    },
    onError: (error: Error & { status?: number }) => {
      if (error.status === 409 && editingDraft) {
        setStaleMessage("This schedule is no longer editable because its revision changed or dispatch is due. The saved details remain in the composer; refresh schedules before trying again.");
        void scheduledQuery.refetch();
      }
    },
  });
  const confirmMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Create a fresh preview before confirming.");
      return api<BroadcastDetail>(`/api/email-broadcasts/${preview.broadcast.id}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientCount: preview.broadcast.counts.sendable, expectedRevision: preview.broadcast.revision }),
      });
    },
    onSuccess: (detail) => {
      setPreview(detail);
      setSelectedId(detail.broadcast.id);
      setConfirmOpen(false);
      setEditingDraft(null);
      setScheduleDateTime("");
      queryClient.setQueryData(["/api/email-broadcasts", detail.broadcast.id], detail);
      void historyQuery.refetch();
      void scheduledQuery.refetch();
    },
    onError: (error: Error & { status?: number }) => {
      if (error.status === 409) {
        requestId.current = newRequestId();
        setPreview(null);
        setConfirmOpen(false);
        setStaleMessage(editingDraft
          ? "This schedule changed or became due after editing began. Refresh the scheduled list and reload its latest revision before continuing."
          : "The recipient list changed after this preview. Your message is retained; preview again to review the current recipients before confirming.");
        void recipientsQuery.refetch();
        void historyQuery.refetch();
        void scheduledQuery.refetch();
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
      void scheduledQuery.refetch();
    },
  });

  const recipients = recipientsQuery.data;
  let scheduleIssue = editingDraft && !scheduleDateTime ? "A future scheduled time is required while editing this schedule." : "";
  if (scheduleDateTime) {
    try {
      if (!scheduleTimeZone.trim()) throw new Error("Enter an IANA time zone.");
      const scheduledInstant = localDateTimeToIso(scheduleDateTime, scheduleTimeZone.trim());
      if (new Date(scheduledInstant).getTime() <= Date.now()) throw new Error("Choose a future schedule time.");
    } catch (error) {
      scheduleIssue = error instanceof Error ? error.message : "The scheduled local time is invalid.";
    }
  }
  const canPreview = !!subject.trim() && !!body.trim() && !scheduleIssue && !previewMutation.isPending && !confirmMutation.isPending && !previewRefreshing && !editLoading;
  const inputsDisabled = previewMutation.isPending || confirmMutation.isPending || previewRefreshing || editLoading;
  const selectedDetail = detailQuery.data?.broadcast.id === selectedId ? detailQuery.data : preview?.broadcast.id === selectedId ? preview : null;
  const confirmError = confirmMutation.error as (Error & { status?: number }) | null;
  const currentError = cancelMutation.error || previewMutation.error || (confirmError?.status === 409 ? null : confirmError);
  const selectedEditDetail = editingDraft?.clientIds?.length && selectedDetail?.broadcast.id === editingDraft.id ? selectedDetail : null;
  const audienceClients: BroadcastClient[] = selectedEditDetail
    ? selectedEditDetail.recipients.filter((recipient) => recipient.clientId !== null && editingDraft?.clientIds?.includes(recipient.clientId))
      .map((recipient) => ({
        id: recipient.clientId!,
        name: recipient.clientName,
        email: recipient.email,
        status: "",
        assignedProcessor: null,
        canSend: recipient.status !== "skipped",
        skipReason: recipient.status === "skipped" ? recipient.error || "Not eligible to receive email" : null,
      }))
    : recipients?.clients || [];
  const audienceCounts = selectedEditDetail
    ? { matched: selectedEditDetail.broadcast.counts.total, sendable: selectedEditDetail.broadcast.counts.sendable, skipped: selectedEditDetail.broadcast.counts.skipped }
    : recipients?.counts;
  const beginPreview = async () => {
    if (previewGuard.current || !canPreview) return;
    previewGuard.current = true;
    setPreviewRefreshing(true);
    try {
      if (!editingDraft) {
        const latestAudience = await recipientsQuery.refetch();
        if (latestAudience.error || !latestAudience.data?.counts.sendable) {
          previewGuard.current = false;
          setPreviewRefreshing(false);
          return;
        }
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
  const applyTemplate = (template: EmailTemplate | null) => {
    setTemplateName(template?.id || "");
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
    }
  };
  const loadScheduledForEdit = async (item: ScheduledBroadcast) => {
    setEditLoading(true);
    setEditError("");
    setSelectedId(item.id);
    setConfirmOpen(false);
    setPreview(null);
    try {
      const detail = await api<BroadcastDetail>(`/api/email-broadcasts/${item.id}`);
      queryClient.setQueryData(["/api/email-broadcasts", item.id], detail);
      const saved = detail.broadcast as ScheduledBroadcast;
      const clientIds = saved.clientIds || undefined;
      setSearch(saved.filters?.search || "");
      setStatus(saved.filters?.status || "");
      setAssignedProcessor(saved.filters?.assignedProcessor || "");
      setSubject(saved.subject || "");
      setBody(saved.body || "");
      setTemplateName(saved.templateName || "");
      setScheduleTimeZone(saved.scheduleTimeZone || "America/Denver");
      setScheduleDateTime(saved.scheduledAt ? isoToLocalDateTime(saved.scheduledAt, saved.scheduleTimeZone || "America/Denver") : "");
      setEditingDraft({ id: item.id, revision: saved.revision, ...(clientIds?.length ? { clientIds } : {}) });
      setStaleMessage("");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not load scheduled broadcast.");
    } finally {
      setEditLoading(false);
    }
  };
  const reviewHoliday = (holiday: ReturnType<typeof federalHolidays>[number], localDateTime: string, zone: string) => {
    const template = BUILT_IN_EMAIL_TEMPLATES.find((item) => item.id === holiday.templateId) || null;
    if (template) {
      setTemplateName(template.id);
      setSubject(template.subject);
      const closureText = `Trucking Pros Financial will be closed in observance of ${holiday.name} on ${holiday.observedDate}.`;
      setBody(template.body.replace(/Trucking Pros Financial will be closed in observance of [^.]+\./, closureText));
    }
    setScheduleDateTime(localDateTime);
    setScheduleTimeZone(zone);
    setEditingDraft(null);
    setStaleMessage("");
    setEditError("");
    const element = document.getElementById("broadcast-subject");
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const statusOptions = optionsQuery.data?.statuses || [];

  return <section className="email-neu-panel border border-[#899795] bg-[#edf2ef] shadow-[1px_1px_0_#fff]">
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
            <div className="space-y-1"><Label htmlFor="broadcast-search" className="text-[10px]">Client search</Label><Input id="broadcast-search" value={search} disabled={inputsDisabled} onChange={(e) => setSearch(e.target.value)} maxLength={200} placeholder="Name or email…" className="text-xs" /></div>
            <div className="space-y-1"><Label htmlFor="broadcast-status" className="text-[10px]">Client status</Label><Select value={status || "all"} disabled={inputsDisabled} onValueChange={(value) => setStatus(value === "all" ? "" : value)}><SelectTrigger id="broadcast-status" className="h-10 rounded-xl border-0 bg-[#e0e0e0] text-xs shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent className="rounded-xl border-0 bg-[#e0e0e0] shadow-[4px_4px_12px_#b8b8b8]"><SelectItem value="all">All statuses</SelectItem>{statusOptions.map((option) => <SelectItem key={option} value={option}>{option.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="broadcast-agent" className="text-[10px]">Assigned processor</Label><Select value={assignedProcessor || "all"} disabled={inputsDisabled} onValueChange={(value) => setAssignedProcessor(value === "all" ? "" : value)}><SelectTrigger id="broadcast-agent" className="h-10 rounded-xl border-0 bg-[#e0e0e0] text-xs shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]"><SelectValue placeholder="All processors" /></SelectTrigger><SelectContent className="rounded-xl border-0 bg-[#e0e0e0] shadow-[4px_4px_12px_#b8b8b8]"><SelectItem value="all">All processors</SelectItem>{(optionsQuery.data?.agents || []).map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
          {optionsQuery.isLoading ? <div className="h-8 animate-pulse rounded-xl bg-[#e0e0e0] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]" /> : optionsQuery.error ? <NeuNotice severity="block" role="alert" className="flex items-center justify-between gap-2 text-[10px]"><span>{optionsQuery.error.message}</span><Button size="sm" variant="outline" onClick={() => void optionsQuery.refetch()}>Retry</Button></NeuNotice> : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-[#c6d0cd] bg-[#f8faf8] px-3 py-2 text-[10px] text-[#536a6d]">
            {!selectedEditDetail && recipientsQuery.isLoading ? <span className="h-3 w-36 animate-pulse bg-[#dce5e1]" /> : !selectedEditDetail && recipientsQuery.error ? <span className="text-[#8d433a]">{recipientsQuery.error.message}</span> : <>
              <span><strong className="text-[#304a52]">{audienceCounts?.matched ?? 0}</strong> matched</span><span><strong className="text-[#28644f]">{audienceCounts?.sendable ?? 0}</strong> sendable</span><span><strong className="text-[#866322]">{audienceCounts?.skipped ?? 0}</strong> skipped</span>
              {selectedEditDetail && <span className="font-semibold text-[#326572]">{editingDraft?.clientIds?.length} explicitly selected IDs</span>}
            </>}
            {!selectedEditDetail && recipientsQuery.isFetching && !recipientsQuery.isLoading && <RefreshCw className="h-3 w-3 animate-spin text-[#087f8e]" />}
          </div>
          {!selectedEditDetail && recipientsQuery.error && <Button size="sm" variant="outline" onClick={() => void recipientsQuery.refetch()}>Retry recipient list</Button>}
          <div className="max-h-40 overflow-auto border border-[#c6d0cd] bg-[#f8faf8]">
            {!selectedEditDetail && recipientsQuery.isLoading ? <div className="space-y-1 p-2"><div className="h-6 animate-pulse bg-[#dce5e1]" /><div className="h-6 animate-pulse bg-[#dce5e1]" /></div>
              : !audienceClients.length ? <p className="px-3 py-4 text-center text-[10px] text-[#73817f]">{selectedEditDetail ? "No recipient details are available for these saved IDs." : "No clients match this audience."}</p>
                : audienceClients.map((client) => <div key={client.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#e0e6e3] px-2.5 py-1.5 last:border-b-0">
                  {client.canSend ? <Check className="h-3 w-3 shrink-0 text-[#398269]" /> : <X className="h-3 w-3 shrink-0 text-[#a6574e]" />}
                  <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#304a52]">{client.name}</span><span className="max-w-[40%] truncate text-[9px] text-[#758582]">{client.email || "No email"}</span>
                  {!client.canSend && <span className="w-full pl-5 text-[9px] text-[#8d433a]">{client.skipReason || "Not eligible to receive email"}</span>}
                </div>)}
          </div>
        </div>
        <div className="space-y-2 border-t border-[#cbd5d1] pt-3">
          <div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#758582]">Schedule / optional</p><h3 className="text-xs font-bold text-[#304a52]">Send now or set a local time</h3></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="broadcast-scheduled-at" className="text-[10px]">Scheduled date and time</Label><Input id="broadcast-scheduled-at" type="datetime-local" required={!!editingDraft} value={scheduleDateTime} disabled={inputsDisabled} onChange={(event) => setScheduleDateTime(event.target.value)} className="text-xs" /><p className="text-[9px] text-[#758582]">{editingDraft ? "The schedule must remain in the future." : "Blank means the existing immediate-send flow."}</p></div>
            <div className="space-y-1"><Label htmlFor="broadcast-time-zone" className="text-[10px]">Time zone (IANA)</Label><Input id="broadcast-time-zone" value={scheduleTimeZone} disabled={inputsDisabled} onChange={(event) => setScheduleTimeZone(event.target.value)} placeholder="America/Denver" className="text-xs" /><p className="text-[9px] text-[#758582]">Local wall time is converted using this zone, not your browser zone.</p></div>
          </div>
          {scheduleIssue && <NeuNotice severity="ack" role="alert" className="text-[9px]">{scheduleIssue} Check daylight-saving gaps and use a valid IANA zone.</NeuNotice>}
          {editingDraft && <p className="border border-[#d5b77b] bg-[#fff8e9] p-2 text-[9px] leading-relaxed text-[#765f30]">Editing schedule rev {editingDraft.revision}. Edit preview creates a draft revision and pauses the previous scheduled dispatch. Nothing sends until you review and confirm the new revision.</p>}
          {editLoading && <div className="h-8 animate-pulse border border-[#c6d0cd] bg-[#dce5e1]" aria-label="Loading scheduled draft" />}
          {editError && <NeuNotice severity="block" role="alert" className="text-[10px]">{editError}<Button type="button" size="sm" variant="outline" className="ml-2 h-6" onClick={() => setEditError("")}>Dismiss</Button></NeuNotice>}
        </div>
        <HolidayYearPlanner onReview={reviewHoliday} />
        <div className="space-y-2 border-t border-[#cbd5d1] pt-3">
          <div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#758582]">02 / Message</p><h3 className="text-xs font-bold text-[#304a52]">Write once, delivered separately</h3></div>
          <EmailTemplatePicker id="broadcast-template" value={templateName} onChange={applyTemplate} disabled={inputsDisabled} />
          <p className="border border-[#c6d0cd] bg-[#f8faf8] p-2 text-[10px] leading-relaxed text-[#657977]">The [Company] placeholder is personalized separately for each recipient; if a company name is unavailable, “Valued Client” is used. Review observed closure dates and hours before sending.</p>
          <div className="space-y-1"><Label htmlFor="broadcast-subject" className="text-[10px]">Subject</Label><Input id="broadcast-subject" value={subject} disabled={inputsDisabled} maxLength={200} onChange={(e) => setSubject(e.target.value)} className="text-xs" placeholder="A clear, specific subject" /><p className="text-right text-[9px] text-[#84918f]">{subject.length}/200</p></div>
          <div className="space-y-1"><Label htmlFor="broadcast-body" className="text-[10px]">Message</Label><Textarea id="broadcast-body" value={body} disabled={inputsDisabled} maxLength={20000} rows={7} onChange={(e) => setBody(e.target.value)} className="resize-y text-xs leading-relaxed" placeholder="Write your message…" /><p className="text-right text-[9px] text-[#84918f]">{body.length}/20,000</p></div>
          <p className="text-[10px] text-[#657977]">TPF branding and monitored Reply-To are applied by the server sender. No recipient is exposed to another.</p>
          {staleMessage && <NeuNotice severity="ack" role="alert" className="text-[10px] leading-relaxed">{staleMessage}</NeuNotice>}
          {currentError && <NeuNotice severity="block" role="alert" className="text-[10px] leading-relaxed"><strong>Draft retained.</strong> {currentError.message}</NeuNotice>}
          <Button type="button" variant="accent" disabled={!canPreview || (!editingDraft && (recipientsQuery.isLoading || recipientsQuery.isError || !recipients?.counts.sendable))} onClick={() => void beginPreview()} className="min-h-9 w-full text-xs font-bold">
            {scheduleDateTime ? <CalendarClock className="mr-2 h-3.5 w-3.5" /> : <Send className="mr-2 h-3.5 w-3.5" />}{previewRefreshing ? "Refreshing audience…" : previewMutation.isPending ? "Preparing preview…" : editingDraft ? "Review schedule changes" : scheduleDateTime ? "Preview scheduled broadcast" : "Preview broadcast"}
          </Button>
        </div>
      </div>

      <div className="min-w-0 p-3 md:p-4">
        <div className="mb-4">
          <ScheduledBroadcasts
            items={scheduledQuery.data || []}
            loading={scheduledQuery.isLoading}
            error={scheduledQuery.error ? (scheduledQuery.error as Error).message : undefined}
            cancellingId={cancelMutation.isPending ? cancelMutation.variables || null : null}
            onRetry={() => void scheduledQuery.refetch()}
            onSelect={(id) => { setSelectedId(id); setConfirmOpen(false); }}
            onEdit={(item) => void loadScheduledForEdit(item)}
            onCancel={(id) => {
              if (cancelGuard.current) return;
              cancelGuard.current = true;
              cancelMutation.mutate(id, { onSettled: () => { cancelGuard.current = false; } });
            }}
          />
        </div>
        <div className="mb-3 flex items-center justify-between gap-2"><div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#758582]">03 / Activity</p><h3 className="text-xs font-bold text-[#304a52]">Broadcast history</h3></div><Button size="sm" variant="outline" className="h-7 rounded-sm px-2 text-[10px]" onClick={() => void historyQuery.refetch()} disabled={historyQuery.isFetching}><RefreshCw className={`mr-1.5 h-3 w-3 ${historyQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>
        {historyQuery.isLoading ? <div className="space-y-2"><div className="h-12 animate-pulse bg-[#dce5e1]" /><div className="h-12 animate-pulse bg-[#dce5e1]" /></div>
          : historyQuery.error ? <NeuNotice severity="block" role="alert" className="flex items-center justify-between gap-2 text-[10px]"><span>{historyQuery.error.message}</span><Button size="sm" variant="outline" onClick={() => void historyQuery.refetch()}>Retry</Button></NeuNotice>
            : !historyQuery.data?.length ? <div className="border border-dashed border-[#bdc9c5] bg-[#f6f8f6] px-4 py-8 text-center"><Mail className="mx-auto mb-2 h-5 w-5 text-[#849794]" /><p className="text-xs font-semibold text-[#536a6d]">No broadcasts yet</p><p className="mt-1 text-[10px] text-[#7b8b89]">A broadcast only starts after a fresh preview and a separate confirmation.</p></div>
              : <div className="max-h-64 space-y-1 overflow-auto">
                {historyQuery.data.map((item) => <Button key={item.id} type="button" size="sm" onClick={() => { setSelectedId(item.id); setConfirmOpen(false); }} className={`w-full justify-start text-left ${item.id === selectedId ? "text-[#087f8e]" : ""}`}>
                  <StatusTag value={item.status} /><span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#304a52]">{item.subject || "(No subject)"}</span><span className="hidden text-[9px] text-[#73817f] sm:inline">{item.counts.sent}/{item.counts.total}</span><span className="text-[9px] text-[#73817f]">{dateTime(item.createdAt)}</span>
                </Button>)}
              </div>}
        {selectedId && detailQuery.isLoading && <div className="mt-3 space-y-2 border border-[#c6d0cd] bg-[#f8faf8] p-3" aria-label="Loading broadcast details"><div className="h-6 animate-pulse bg-[#dce5e1]" /><div className="h-20 animate-pulse bg-[#dce5e1]" /></div>}
        {selectedId && detailQuery.error && <NeuNotice severity="block" role="alert" className="mt-3 flex items-center justify-between gap-2 text-[10px]"><span>{detailQuery.error.message}</span><Button size="sm" variant="outline" onClick={() => void detailQuery.refetch()}>Retry details</Button></NeuNotice>}
        {selectedDetail && <div className="mt-3 border border-[#9aa7a5] bg-[#f8faf8]">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#c4cfcb] bg-[#e7eeeb] px-3 py-2"><div className="flex items-center gap-2"><h4 className="text-[11px] font-bold text-[#304a52]">Selected broadcast</h4><StatusTag value={selectedDetail.broadcast.status} /></div>{(activeStatus(selectedDetail.broadcast.status) || (selectedDetail.broadcast as ScheduledBroadcast).status === "scheduled") && <Button size="sm" variant="outline" disabled={cancelMutation.isPending} onClick={() => { if (cancelGuard.current) return; cancelGuard.current = true; cancelMutation.mutate(selectedDetail.broadcast.id, { onSettled: () => { cancelGuard.current = false; } }); }} className="h-7 rounded-sm px-2 text-[10px]"><X className="mr-1 h-3 w-3" />{cancelMutation.isPending ? "Stopping…" : (selectedDetail.broadcast as ScheduledBroadcast).status === "scheduled" ? "Cancel schedule" : "Cancel queued sends"}</Button>}</header>
          <div className="grid grid-cols-2 gap-px border-b border-[#d3dcda] bg-[#d3dcda] sm:grid-cols-3">
            {(["total", "sendable", "skipped", "sent", "failed", "unconfirmed", "pending"] as const).map((key) => <div key={key} className="bg-[#f3f7f4] px-2.5 py-2"><p className="text-[8px] font-bold uppercase tracking-wider text-[#7a8986]">{key}</p><p className="font-mono text-sm font-bold text-[#304a52]">{selectedDetail.broadcast.counts[key]}</p></div>)}
          </div>
          <div className="space-y-2 p-3">
            <p className="text-[10px] text-[#647876]">Created by {selectedDetail.broadcast.createdByName || selectedDetail.broadcast.createdBy} · {dateTime(selectedDetail.broadcast.createdAt)}{selectedDetail.broadcast.confirmedAt ? ` · confirmed ${dateTime(selectedDetail.broadcast.confirmedAt)}` : ""}</p>
            {selectedDetail.broadcast.error && <NeuNotice severity="block" role="alert" className="text-[10px] leading-relaxed"><strong>Schedule failed.</strong> {selectedDetail.broadcast.error}</NeuNotice>}
            {(selectedDetail.broadcast as ScheduledBroadcast).scheduledAt && <div className="border border-[#a8c5ca] bg-[#edf6f7] p-2 text-[9px] text-[#326572]">
              <strong>Scheduled:</strong> {scheduledLabel((selectedDetail.broadcast as ScheduledBroadcast).scheduledAt!, (selectedDetail.broadcast as ScheduledBroadcast).scheduleTimeZone || "America/Denver")} · {(selectedDetail.broadcast as ScheduledBroadcast).scheduleTimeZone || "America/Denver"}
              <p className="mt-1 text-[#536a6d]">Audience rules: {Object.entries(selectedDetail.broadcast.filters || {}).length ? Object.entries(selectedDetail.broadcast.filters).map(([key, value]) => `${key}: ${value}`).join(" · ") : "All clients"}{(selectedDetail.broadcast as ScheduledBroadcast).clientIds?.length ? ` · ${((selectedDetail.broadcast as ScheduledBroadcast).clientIds || []).length} explicitly selected IDs` : ""}. Filter rules are re-evaluated at dispatch; estimate may change.</p>
            </div>}
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
      <DialogContent className="email-neu-dialog max-h-[92dvh] max-w-xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-[#b8c3bf] bg-[#d6e2de] px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm font-bold text-[#203a46]"><AlertCircle className="h-4 w-4 text-[#a26e27]" />{(preview.broadcast as ScheduledBroadcast).scheduledAt ? "Confirm scheduled broadcast" : "Confirm broadcast"}</DialogTitle>
          <DialogDescription className="mt-1 text-[10px] text-[#596d70]">{(preview.broadcast as ScheduledBroadcast).scheduledAt ? "This is the final review. Confirmation saves the schedule; it does not send immediately." : "This is the final review. Confirmation queues individual client emails."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2"><div className="border border-[#b7cfca] bg-[#f1f7f4] p-2"><p className="text-[9px] font-bold uppercase tracking-wide text-[#657977]">Sendable</p><p className="font-mono text-xl font-bold text-[#28644f]">{preview.broadcast.counts.sendable}</p></div><div className="border border-[#d6b076] bg-[#fff8e9] p-2"><p className="text-[9px] font-bold uppercase tracking-wide text-[#765f30]">Skipped</p><p className="font-mono text-xl font-bold text-[#866322]">{preview.broadcast.counts.skipped}</p></div></div>
          {(preview.broadcast as ScheduledBroadcast).scheduledAt && <div className="border border-[#a8c5ca] bg-[#edf6f7] p-2.5 text-[10px] leading-relaxed text-[#326572]">
            <p className="font-bold">Scheduled for {scheduledLabel((preview.broadcast as ScheduledBroadcast).scheduledAt!, (preview.broadcast as ScheduledBroadcast).scheduleTimeZone || "America/Denver")}</p>
            <p className="mt-0.5">Time zone: {(preview.broadcast as ScheduledBroadcast).scheduleTimeZone || "America/Denver"}</p>
            <p className="mt-1 border-t border-[#c7dadd] pt-1.5">This count is an estimate. Filter-based audience rules are evaluated again at send time, including clients who match later; the recipient total may change. Explicit client IDs remain restricted to that selection.</p>
          </div>}
          <div className="border border-[#c6d0cd] bg-white p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-[#758582]">Subject</p><p className="mt-1 break-words text-xs font-bold text-[#304a52]">{preview.broadcast.subject}</p><p className="mt-3 text-[9px] font-bold uppercase tracking-wide text-[#758582]">Body preview</p><p className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#34494c]">{preview.broadcast.body}</p></div>
          <div className="max-h-32 overflow-auto border border-[#d6b076] bg-[#fff8e9] p-2.5 text-[10px] text-[#765f30]"><p className="mb-1 font-bold">Skipped recipients and reasons</p>{preview.recipients.filter((recipient) => recipient.status === "skipped" || recipient.error).length ? preview.recipients.filter((recipient) => recipient.status === "skipped" || recipient.error).map((recipient) => <p key={recipient.id} className="border-t border-[#ead8b1] py-1">{recipient.clientName}: {recipient.error || "Not eligible to receive email"}</p>) : <p>None. All matched clients can receive this message.</p>}</div>
          <p className="text-[10px] leading-relaxed text-[#596d70]">Confirm the current estimate of <strong>{preview.broadcast.counts.sendable}</strong> sendable recipients. The server rechecks audience and preview expiry before queueing. Broadcasts cannot be CC’d or BCC’d.</p>
          {confirmError && confirmError.status !== 409 && <NeuNotice severity="block" role="alert" className="text-[10px]">Confirmation failed; your draft is retained. {confirmError.message}</NeuNotice>}
        </div>
        <DialogFooter className="flex flex-wrap justify-end gap-2 border-t border-[#c5cfcc] bg-[#e1e8e5] px-4 py-3">
          <Button type="button" variant="outline" className="h-8 rounded-sm text-xs" disabled={confirmMutation.isPending} onClick={() => setConfirmOpen(false)}>Review message</Button>
          <Button type="button" variant="accent" className="min-h-9 px-4 text-xs" disabled={confirmMutation.isPending || preview.broadcast.counts.sendable < 1} onClick={() => { if (confirmGuard.current) return; confirmGuard.current = true; confirmMutation.mutate(undefined, { onSettled: () => { confirmGuard.current = false; } }); }}><Check className="mr-1.5 h-3.5 w-3.5" />{confirmMutation.isPending ? "Confirming…" : (preview.broadcast as ScheduledBroadcast).scheduledAt ? "Confirm schedule" : `Confirm ${preview.broadcast.counts.sendable} emails`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
  </section>;
}
