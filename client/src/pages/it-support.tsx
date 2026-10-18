import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertCircle, Bug, Check, ChevronRight, Clock3, Lightbulb, MessageSquareText,
  Plus, Send, ShieldCheck, Trash2, Wrench,
} from "lucide-react";
import {
  PageShell, Win95Badge, Win95Button as Button, Win95Card as Card,
  Win95CardContent as CardContent, Win95Input as Input, Win95Select as Select,
  Win95SelectContent as SelectContent, Win95SelectItem as SelectItem,
  Win95SelectTrigger as SelectTrigger, Win95SelectValue as SelectValue,
} from "@/components/win95";

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
const priorityTone: Record<Priority, string> = {
  urgent: "border-[#b8786e] bg-[#f4dfdb] text-[#812f25]",
  high: "border-[#c08a57] bg-[#f6e7d7] text-[#75451f]",
  medium: "border-[#b3954e] bg-[#f5edce] text-[#6b5416]",
  low: "border-[#8b9e9b] bg-[#e2ecea] text-[#3d625c]",
};

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
    <PageShell title="IT Support" subtitle="Software issues and ideas for FactorFlux" group="Workspace" contentClassName="space-y-4 p-3 sm:p-5 xl:p-7">
      <header className="flex flex-col gap-3 rounded-sm border-2 border-b-[#808080] border-r-[#808080] border-l-white border-t-white bg-[#d4d0c8] p-4 shadow-bevel-light sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><Wrench className="h-5 w-5 text-[#087f8c]" /><h1 className="text-xl font-bold text-[#252525]">IT &amp; Software Support</h1></div>
          <p className="mt-1 max-w-2xl text-sm text-[#505050]">A direct line for bugs, product ideas, and questions about the FactorFlux system.</p>
        </div>
        <Button primary className="shrink-0 gap-2" onClick={() => { setPageMessage(""); setFormOpen((open) => !open); }}><Plus className="h-4 w-4" />Submit Request</Button>
      </header>

      {pageMessage && <div role={messageError ? "alert" : "status"} className={`flex items-start gap-2 border-2 px-3 py-2 text-sm ${messageError ? "border-[#b8786e] bg-[#f4dfdb] text-[#812f25]" : "border-[#8b9e9b] bg-[#e2ecea] text-[#315953]"}`}>{messageError ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}{pageMessage}</div>}
      {metaQuery.isLoading && <Card><CardContent className="space-y-3"><div className="h-4 w-44 animate-pulse bg-[#dedbd4]" /><div className="h-3 w-2/3 animate-pulse bg-[#e8e6e1]" /></CardContent></Card>}
      {metaQuery.isError && <Card><CardContent className="flex items-center gap-3 text-sm text-[#812f25]"><AlertCircle className="h-5 w-5" />{(metaQuery.error as Error).message}<Button className="ml-auto" onClick={() => metaQuery.refetch()}>Retry</Button></CardContent></Card>}

      {meta && <>
        <div className="flex items-center gap-2 border-2 border-[#9bb4ac] bg-[#e5efeb] px-3 py-2 text-sm text-[#315953]"><ShieldCheck className="h-4 w-4" /><span>Designated IT contact: <strong>Dosh Barzanji</strong></span></div>

        {formOpen && <Card className="border-[#087f8c]"><CardContent className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-base font-bold">Submit a software request</h2><span className="text-xs text-[#656565]">All staff can submit</span></div>
          <Input aria-label="Request title" placeholder="Short, specific title" maxLength={180} value={form.title} onChange={(event) => formValue("title", event.target.value)} />
          <textarea aria-label="Request description" className="min-h-28 w-full resize-y rounded-sm border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-white p-3 text-sm text-[#222] shadow-bevel-dark outline-none focus:ring-2 focus:ring-[#087f8c]/30" placeholder="What happened or what would you like to improve? Include steps or context." value={form.description} onChange={(event) => formValue("description", event.target.value)} />
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Select value={form.type} onValueChange={(value) => formValue("type", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bug">Bug / issue</SelectItem><SelectItem value="feature_idea">Feature idea</SelectItem><SelectItem value="question">Question</SelectItem></SelectContent></Select>
            <Select value={form.priority} onValueChange={(value) => formValue("priority", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(["low", "medium", "high", "urgent"] as Priority[]).map((priority) => <SelectItem key={priority} value={priority}>{label(priority)} priority</SelectItem>)}</SelectContent></Select>
            <Button primary className="gap-2" disabled={createRequest.isPending || !form.title.trim() || !form.description.trim()} onClick={() => { setPageMessage(""); createRequest.mutate(); }}><Send className="h-4 w-4" />{createRequest.isPending ? "Submitting…" : "Send request"}</Button>
          </div>
        </CardContent></Card>}

        <div className={`grid items-start gap-4 ${requestId ? "xl:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)]" : ""}`}>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#b8b5ad] bg-[#e8e6e1] px-4 py-3">
              <div><h2 className="font-bold text-[#292929]">{isTriage ? "Triage queue" : "Your requests"}</h2><p className="text-xs text-[#5c5c5c]">{isTriage ? "All staff requests awaiting IT review" : "Requests submitted from your account"}</p></div>
              {meta.isContact && <div className="flex gap-1 rounded-sm border-2 border-b-white border-r-white border-l-[#808080] border-t-[#808080] bg-[#c8c6c0] p-0.5">
                <button type="button" onClick={() => setScope("triage")} className={`px-2.5 py-1 text-xs font-semibold ${isTriage ? "bg-white text-[#087f8c] shadow-sm" : "text-[#454545]"}`}>Triage</button>
                <button type="button" onClick={() => setScope("mine")} className={`px-2.5 py-1 text-xs font-semibold ${!isTriage ? "bg-white text-[#087f8c] shadow-sm" : "text-[#454545]"}`}>My requests</button>
              </div>}
            </div>
            {listQuery.isLoading ? <div className="space-y-2 p-4" aria-label="Loading requests">{[0, 1, 2].map((i) => <div key={i} className="h-[68px] animate-pulse border border-[#e0ded8] bg-[#f2f1ed]" />)}</div>
              : listQuery.isError ? <div className="p-5 text-sm text-[#812f25]"><p>{(listQuery.error as Error).message}</p><Button className="mt-3" onClick={() => listQuery.refetch()}>Retry loading requests</Button></div>
              : requests.length === 0 ? <div className="flex flex-col items-center px-5 py-10 text-center"><div className="mb-3 flex h-12 w-12 items-center justify-center border-2 border-b-[#808080] border-r-[#808080] border-l-white border-t-white bg-[#d4d0c8] text-[#087f8c]"><MessageSquareText className="h-6 w-6" /></div><p className="font-bold text-[#333]">{isTriage ? "The queue is clear" : "No requests yet"}</p><p className="mt-1 max-w-sm text-sm text-[#666]">{isTriage ? "New staff software requests will appear here." : "When you report an issue or idea, it will appear here with its status and responses."}</p></div>
              : <div className="divide-y divide-[#d6d3cc]">
                {requests.map((item) => <button key={item.id} type="button" onClick={() => openRequest(item.id)} className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#eef5f3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#087f8c] ${String(requestId) === String(item.id) ? "bg-[#e2efec]" : "bg-white"}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center border border-[#aaa79f] ${item.type === "bug" ? "bg-[#f4dfdb] text-[#8d3d32]" : item.type === "feature_idea" ? "bg-[#f5edce] text-[#806523]" : "bg-[#e2ecea] text-[#3d625c]"}`}>{item.type === "bug" ? <Bug className="h-4 w-4" /> : item.type === "feature_idea" ? <Lightbulb className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate font-semibold text-[#292929]">{item.title}</span><Win95Badge variant="outline" className={priorityTone[item.priority]}>{label(item.priority)}</Win95Badge></span><span className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[#666]"><span>{isTriage ? item.submittedByName : label(item.type)}</span><span>{dateTime(item.updatedAt)}</span></span></span>
                  <span className="flex shrink-0 flex-col items-end gap-1"><span className={`border px-1.5 py-0.5 text-[10px] font-semibold ${item.status === "resolved" ? "border-[#8b9e8d] bg-[#e1ece2] text-[#416344]" : item.status === "in_progress" ? "border-[#8fa9b0] bg-[#e3edf0] text-[#3d626c]" : "border-[#b3954e] bg-[#f5edce] text-[#6b5416]"}`}>{label(item.status)}</span><ChevronRight className="h-4 w-4 text-[#777]" /></span>
                </button>)}
              </div>}
          </Card>

          {requestId && <Card className="min-w-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#b8b5ad] bg-[#e8e6e1] px-4 py-3"><div><h2 className="font-bold text-[#292929]">Request details</h2><p className="text-xs text-[#666]">Request #{requestId}</p></div><Button className="h-8 px-2 text-xs" onClick={closeDetail}>Close</Button></div>
            {detailQuery.isLoading ? <CardContent className="space-y-3"><div className="h-5 w-2/3 animate-pulse bg-[#dedbd4]" /><div className="h-24 animate-pulse bg-[#e8e6e1]" /></CardContent>
              : detailQuery.isError ? <CardContent><div className="flex items-center gap-2 text-sm text-[#812f25]"><AlertCircle className="h-4 w-4" />{(detailQuery.error as Error).message}</div><Button className="mt-3" onClick={() => detailQuery.refetch()}>Retry</Button></CardContent>
              : selected && <div className="space-y-4 p-4">
                <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-[#252525]">{selected.request.title}</h3><Win95Badge variant="outline" className={priorityTone[selected.request.priority]}>{label(selected.request.priority)}</Win95Badge></div><p className="mt-1 text-xs text-[#666]">Submitted by {selected.request.submittedByName} · {dateTime(selected.request.createdAt)}</p><div className="mt-3 whitespace-pre-wrap border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-[#faf9f6] p-3 text-sm leading-relaxed text-[#333]">{selected.request.description}</div></div>
                {selected.canManage && <div className="flex flex-col gap-2 rounded-sm border border-[#c9c6be] bg-[#efeee9] p-3 sm:flex-row sm:items-center">
                  <span className="text-xs font-bold uppercase tracking-wide text-[#555]">Update status</span>
                  <Select value={selected.request.status} onValueChange={(value) => updateRequest.mutate({ status: value as RequestStatus })}>
                    <SelectTrigger className="h-9 sm:max-w-[190px]"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="submitted">Submitted</SelectItem><SelectItem value="in_progress">In Progress</SelectItem><SelectItem value="resolved">Resolved</SelectItem></SelectContent>
                  </Select>
                  {updateRequest.isPending && <span className="text-xs text-[#666]">Saving status…</span>}
                </div>}
                <section>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-[#333]"><MessageSquareText className="h-4 w-4 text-[#087f8c]" />Conversation <span className="text-xs font-normal text-[#777]">{selected.responses.length}</span></h4>
                  {selected.responses.length === 0 ? <p className="border border-dashed border-[#bcb9b1] bg-[#f7f6f2] px-3 py-4 text-sm text-[#777]">No responses have been added.</p> : <div className="space-y-2">{selected.responses.map((reply) => <div key={reply.id} className="border border-[#ccc9c1] bg-[#f7f6f2] p-3"><div className="flex flex-wrap justify-between gap-2 text-xs"><strong className="text-[#333]">{reply.authorName}</strong><span className="text-[#777]">{dateTime(reply.createdAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#444]">{reply.body}</p></div>)}</div>}
                </section>
                {selected.canManage && <div className="space-y-2 border-t border-[#d6d3cc] pt-3"><label htmlFor="it-response" className="text-sm font-bold text-[#333]">Add a response</label><textarea id="it-response" className="min-h-24 w-full resize-y rounded-sm border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-[#087f8c]/30" placeholder="Share an update or ask for more information…" value={responseText} onChange={(event) => setResponseText(event.target.value)} /><Button primary disabled={!responseText.trim() || updateRequest.isPending} className="gap-2" onClick={() => updateRequest.mutate({ response: responseText.trim() })}><Send className="h-4 w-4" />Send response</Button></div>}
                {selected.canManage && selected.request.status === "resolved" && <div className="border-t border-[#d6d3cc] pt-3"><Button className="gap-2 text-[#812f25]" disabled={deleteRequest.isPending} onClick={() => { if (window.confirm("Delete this resolved request and its notifications? This cannot be undone.")) deleteRequest.mutate(); }}><Trash2 className="h-4 w-4" />Delete resolved request</Button></div>}
                {!selected.canManage && <div className="flex items-center gap-2 border border-[#d5d2ca] bg-[#f2f1ed] px-3 py-2 text-xs text-[#666]"><Clock3 className="h-4 w-4" />Only the designated IT contact can update status or respond.</div>}
              </div>}
          </Card>}
        </div>
      </>}
    </PageShell>
  );
}
