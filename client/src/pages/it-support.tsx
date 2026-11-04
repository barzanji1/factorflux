import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { PageInsights } from "@/components/PageInsights";
import { useAuth } from "@/hooks/useAuth";
import { AdminPageShell, Badge as NeuBadge, Button, Card, CardContent, Input, SelectContent, SelectTrigger } from "@/components/admin-neu/adapters";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { NeuTextarea } from "@/styles/neu/components";
import "@/components/admin-neu/admin-neu-page.css";
import {
  AlertCircle, Bug, Check, ChevronRight, Clock3, Lightbulb, MessageSquareText,
  Plus, Send, ShieldCheck, Trash2, Wrench,
} from "lucide-react";
import { Select, SelectItem, SelectValue } from "@/components/ui/select";

type RequestType = "bug" | "feature_idea" | "question";
type Priority = "low" | "medium" | "high" | "urgent";
type RequestStatus = "submitted" | "in_progress" | "resolved";
type ITRequest = {
  id: number; title: string; description: string; type: RequestType; priority: Priority;
  status: RequestStatus; submittedByAgentId: string; submittedByName: string;
  createdAt: string; updatedAt: string; resolvedAt: string | null;
};
type Meta = { contact: { id: string; name: string }; isContact: boolean };
type RequestDetail = { request: ITRequest; responses: Array<{ id: number; body: string; createdAt: string; authorName: string }>; canManage: boolean };
type RequestForm = { title: string; description: string; type: RequestType; priority: Priority };

const root = "/api/it-support";
const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `Request failed (${response.status})`);
  return payload as T;
}
const jsonBody = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
function dateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function ItSupport() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const requestId = useMemo(() => new URLSearchParams(search).get("requestId"), [search]);
  const [scope, setScope] = useState<"mine" | "triage">("mine");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RequestForm>({ title: "", description: "", type: "bug", priority: "medium" });
  const [responseText, setResponseText] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  const [messageError, setMessageError] = useState(false);

  const metaQuery = useQuery<Meta>({
    queryKey: [root, "meta", user?.id],
    queryFn: () => requestJson(`${root}/meta`),
    enabled: !!user?.id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  const meta = metaQuery.data;
  useEffect(() => {
    setScope(meta?.isContact ? "triage" : "mine");
  }, [meta?.isContact]);

  useEffect(() => { setResponseText(""); }, [requestId]);

  const listScope = scope === "triage" && meta?.isContact ? "triage" : "mine";
  const listQuery = useQuery<ITRequest[]>({
    queryKey: [root, "requests", user?.id, listScope],
    queryFn: () => requestJson(`${root}/requests?scope=${listScope}`),
    enabled: !!meta,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  const detailQuery = useQuery<RequestDetail>({
    queryKey: [root, "requests", user?.id, requestId, "detail"],
    queryFn: async () => {
      const detail = await requestJson<RequestDetail>(`${root}/requests/${requestId}`);
      queryClient.invalidateQueries({ queryKey: [root, "unread-count"] });
      return detail;
    },
    enabled: !!requestId && !!user?.id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
    retry: false,
  });

  const refreshSupport = () => {
    queryClient.invalidateQueries({ queryKey: [root] });
  };
  const createRequest = useMutation({
    mutationFn: () => requestJson<ITRequest>(`${root}/requests`, jsonBody("POST", form)),
    onSuccess: (created) => {
      setForm({ title: "", description: "", type: "bug", priority: "medium" });
      setFormOpen(false);
      setPageMessage("Your request has been submitted.");
      setMessageError(false);
      refreshSupport();
      setLocation(`/it-support?requestId=${created.id}`);
    },
    onError: (error: Error) => { setPageMessage(error.message); setMessageError(true); },
  });
  const updateRequest = useMutation({
    mutationFn: (body: { status?: RequestStatus; response?: string }) =>
      requestJson<ITRequest>(`${root}/requests/${requestId}`, jsonBody("PATCH", body)),
    onSuccess: () => {
      setResponseText("");
      setPageMessage("Request updated.");
      setMessageError(false);
      refreshSupport();
    },
    onError: (error: Error) => { setPageMessage(error.message); setMessageError(true); },
  });
  const deleteRequest = useMutation({
    mutationFn: () => requestJson<{ deleted: true }>(`${root}/requests/${requestId}`, jsonBody("DELETE", { confirm: true })),
    onSuccess: () => {
      setPageMessage("Resolved request deleted.");
      setMessageError(false);
      setLocation("/it-support");
      refreshSupport();
    },
    onError: (error: Error) => { setPageMessage(error.message); setMessageError(true); },
  });

  const selected = detailQuery.data;
  const requests = listQuery.data ?? [];
  const isTriage = listScope === "triage";
  const openRequest = (id: number) => {
    setPageMessage("");
    setResponseText("");
    setLocation(`/it-support?requestId=${id}`);
  };
  const closeDetail = () => setLocation("/it-support");
  const formValue = (key: keyof RequestForm, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="ff-admin-page flex min-h-[100dvh] bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <TopNav title="IT Support" subtitle="Software issues and ideas for FactorFlux" group="Workspace" />
      <AdminPageShell className="ff-it-neu flex-1 space-y-4 overflow-auto p-3 sm:p-5 xl:p-7">
      <PageInsights entity="it-support" title="Support queue" />
      <header className="flex flex-col gap-3 rounded-2xl bg-[#e0e0e0] p-4 shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><Wrench className="h-5 w-5 text-[#087f8c]" /><h1 className="text-xl font-bold text-[#252525]">IT &amp; Software Support</h1></div>
          <p className="mt-1 max-w-2xl text-sm text-[#505050]">A direct line for bugs, product ideas, and questions about the FactorFlux system.</p>
        </div>
        <Button variant="accent" className="shrink-0 gap-2" onClick={() => { setPageMessage(""); setFormOpen((open) => !open); }}><Plus className="h-4 w-4" />Submit Request</Button>
      </header>

      {pageMessage && <div role={messageError ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff] ${messageError ? "bg-[#f0dfdc] text-[#812f25]" : "bg-[#dce9e5] text-[#315953]"}`}>{messageError ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}{pageMessage}</div>}
      {metaQuery.isLoading && <Card><CardContent className="space-y-3"><div className="h-4 w-44 animate-pulse bg-[#dedbd4]" /><div className="h-3 w-2/3 animate-pulse bg-[#e8e6e1]" /></CardContent></Card>}
      {metaQuery.isError && <Card><CardContent className="flex items-center gap-3 text-sm text-[#812f25]"><AlertCircle className="h-5 w-5" />{(metaQuery.error as Error).message}<Button className="ml-auto" onClick={() => metaQuery.refetch()}>Retry</Button></CardContent></Card>}

      {meta && <>
        <div className="flex items-center gap-2 rounded-xl bg-[#e0e0e0] px-3 py-2 text-sm text-[#315953] shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]"><ShieldCheck className="h-4 w-4" /><span>Designated IT contact: <strong>Dosh Barzanji</strong></span></div>

        {formOpen && <Card><CardContent className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-base font-bold">Submit a software request</h2><span className="text-xs text-[#656565]">All staff can submit</span></div>
          <Input aria-label="Request title" placeholder="Short, specific title" maxLength={180} value={form.title} onChange={(event) => formValue("title", event.target.value)} />
          <NeuTextarea aria-label="Request description" className="min-h-28 resize-y" placeholder="What happened or what would you like to improve? Include steps or context." value={form.description} onChange={(event) => formValue("description", event.target.value)} />
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Select value={form.type} onValueChange={(value) => formValue("type", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bug">Bug / issue</SelectItem><SelectItem value="feature_idea">Feature idea</SelectItem><SelectItem value="question">Question</SelectItem></SelectContent></Select>
            <Select value={form.priority} onValueChange={(value) => formValue("priority", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(["low", "medium", "high", "urgent"] as Priority[]).map((priority) => <SelectItem key={priority} value={priority}>{label(priority)} priority</SelectItem>)}</SelectContent></Select>
            <Button variant="accent" className="gap-2" disabled={createRequest.isPending || !form.title.trim() || !form.description.trim()} onClick={() => { setPageMessage(""); createRequest.mutate(); }}><Send className="h-4 w-4" />{createRequest.isPending ? "Submitting…" : "Send request"}</Button>
          </div>
        </CardContent></Card>}

        <div className={`grid items-start gap-4 ${requestId ? "xl:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)]" : ""}`}>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c9c9c9] px-4 py-3">
              <div><h2 className="font-bold text-[#292929]">{isTriage ? "Triage queue" : "Your requests"}</h2><p className="text-xs text-[#5c5c5c]">{isTriage ? "All staff requests awaiting IT review" : "Requests submitted from your account"}</p></div>
              {meta.isContact && <div className="flex gap-2 rounded-xl bg-[#e0e0e0] p-1 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
                <Button type="button" size="sm" variant={isTriage ? "accent" : "ghost"} onClick={() => setScope("triage")}>Triage</Button>
                <Button type="button" size="sm" variant={!isTriage ? "accent" : "ghost"} onClick={() => setScope("mine")}>My requests</Button>
              </div>}
            </div>
            {listQuery.isLoading ? <div className="space-y-2 p-4" aria-label="Loading requests">{[0, 1, 2].map((i) => <div key={i} className="h-[68px] animate-pulse border border-[#e0ded8] bg-[#f2f1ed]" />)}</div>
              : listQuery.isError ? <div className="p-5 text-sm text-[#812f25]"><p>{(listQuery.error as Error).message}</p><Button className="mt-3" onClick={() => listQuery.refetch()}>Retry loading requests</Button></div>
              : requests.length === 0 ? <div className="flex flex-col items-center px-5 py-10 text-center"><div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#e0e0e0] text-[#168d99] shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]"><MessageSquareText className="h-6 w-6" /></div><p className="font-bold text-[#333]">{isTriage ? "The queue is clear" : "No requests yet"}</p><p className="mt-1 max-w-sm text-sm text-[#666]">{isTriage ? "New staff software requests will appear here." : "When you report an issue or idea, it will appear here with its status and responses."}</p></div>
              : <div className="divide-y divide-[#d6d3cc]">
                {requests.map((item) => <Button key={item.id} type="button" variant="ghost" onClick={() => openRequest(item.id)} className={`flex h-auto w-full items-center justify-start gap-3 rounded-none px-4 py-3 text-left transition-[transform,box-shadow,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#087f8c] ${String(requestId) === String(item.id) ? "bg-[#d7eaea] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]" : "bg-[#e0e0e0] hover:bg-[#dceaea]"}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e0e0e0] shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#c1c1c1] ${item.type === "bug" ? "text-[#8d3d32]" : item.type === "feature_idea" ? "text-[#806523]" : "text-[#3d625c]"}`}>{item.type === "bug" ? <Bug className="h-4 w-4" /> : item.type === "feature_idea" ? <Lightbulb className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate font-semibold text-[#292929]">{item.title}</span><NeuBadge tone={item.priority === "urgent" || item.priority === "high" ? "warning" : "neutral"}>{label(item.priority)}</NeuBadge></span><span className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[#666]"><span>{isTriage ? item.submittedByName : label(item.type)}</span><span>{dateTime(item.updatedAt)}</span></span></span>
                  <span className="flex shrink-0 flex-col items-end gap-1"><NeuBadge tone={item.status === "resolved" ? "success" : item.status === "in_progress" ? "accent" : "warning"} className="px-1.5 py-0.5 text-[10px]">{label(item.status)}</NeuBadge><ChevronRight className="h-4 w-4 text-[#777]" /></span>
                </Button>)}
              </div>}
          </Card>

          {requestId && <Card className="min-w-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#c9c9c9] px-4 py-3"><div><h2 className="font-bold text-[#292929]">Request details</h2><p className="text-xs text-[#666]">Request #{requestId}</p></div><Button size="sm" variant="ghost" onClick={closeDetail}>Close</Button></div>
            {detailQuery.isLoading ? <CardContent className="space-y-3"><div className="h-5 w-2/3 animate-pulse bg-[#dedbd4]" /><div className="h-24 animate-pulse bg-[#e8e6e1]" /></CardContent>
              : detailQuery.isError ? <CardContent><div className="flex items-center gap-2 text-sm text-[#812f25]"><AlertCircle className="h-4 w-4" />{(detailQuery.error as Error).message}</div><Button className="mt-3" onClick={() => detailQuery.refetch()}>Retry</Button></CardContent>
              : selected && <div className="space-y-4 p-4">
                <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-[#252525]">{selected.request.title}</h3><NeuBadge tone={selected.request.priority === "urgent" || selected.request.priority === "high" ? "warning" : "neutral"}>{label(selected.request.priority)}</NeuBadge></div><p className="mt-1 text-xs text-[#666]">Submitted by {selected.request.submittedByName} · {dateTime(selected.request.createdAt)}</p><div className="mt-3 rounded-xl bg-[#e0e0e0] p-3 text-sm leading-relaxed text-[#333] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">{selected.request.description}</div></div>
                {selected.canManage && <div className="flex flex-col gap-2 rounded-xl bg-[#e0e0e0] p-3 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff] sm:flex-row sm:items-center">
                  <span className="text-xs font-bold uppercase tracking-wide text-[#555]">Update status</span>
                  <Select value={selected.request.status} onValueChange={(value) => updateRequest.mutate({ status: value as RequestStatus })}>
                    <SelectTrigger className="h-9 sm:max-w-[190px]"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="submitted">Submitted</SelectItem><SelectItem value="in_progress">In Progress</SelectItem><SelectItem value="resolved">Resolved</SelectItem></SelectContent>
                  </Select>
                  {updateRequest.isPending && <span className="text-xs text-[#666]">Saving status…</span>}
                </div>}
                <section>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-[#333]"><MessageSquareText className="h-4 w-4 text-[#087f8c]" />Conversation <span className="text-xs font-normal text-[#777]">{selected.responses.length}</span></h4>
                  {selected.responses.length === 0 ? <p className="rounded-xl bg-[#e0e0e0] px-3 py-4 text-sm text-[#777] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">No responses have been added.</p> : <div className="space-y-2">{selected.responses.map((reply) => <div key={reply.id} className="rounded-xl bg-[#e0e0e0] p-3 shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]"><div className="flex flex-wrap justify-between gap-2 text-xs"><strong className="text-[#333]">{reply.authorName}</strong><span className="text-[#777]">{dateTime(reply.createdAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#444]">{reply.body}</p></div>)}</div>}
                </section>
                {selected.canManage && <div className="space-y-2 border-t border-[#c9c9c9] pt-3"><label htmlFor="it-response" className="text-sm font-bold text-[#333]">Add a response</label><NeuTextarea id="it-response" className="min-h-24 resize-y" placeholder="Share an update or ask for more information…" value={responseText} onChange={(event) => setResponseText(event.target.value)} /><Button variant="accent" disabled={!responseText.trim() || updateRequest.isPending} className="gap-2" onClick={() => updateRequest.mutate({ response: responseText.trim() })}><Send className="h-4 w-4" />Send response</Button></div>}
                {selected.canManage && selected.request.status === "resolved" && <div className="border-t border-[#d6d3cc] pt-3"><Button className="gap-2 text-[#812f25]" disabled={deleteRequest.isPending} onClick={() => { if (window.confirm("Delete this resolved request and its notifications? This cannot be undone.")) deleteRequest.mutate(); }}><Trash2 className="h-4 w-4" />Delete resolved request</Button></div>}
                {!selected.canManage && <div className="flex items-center gap-2 rounded-xl bg-[#e0e0e0] px-3 py-2 text-xs text-[#666] shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]"><Clock3 className="h-4 w-4" />Only the designated IT contact can update status or respond.</div>}
              </div>}
          </Card>}
        </div>
      </>}
      </AdminPageShell>
      </div>
    </div>
  );
}
