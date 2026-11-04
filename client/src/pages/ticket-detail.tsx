import { useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Badge, Button, Textarea, SelectContent, SelectTrigger, Card, AdminPageShell } from "@/components/admin-neu/adapters";
import { Select, SelectItem, SelectValue } from "@/components/ui/select";
import { NeuTable, NeuTableBody, NeuTableCell, NeuTableRow } from "@/styles/neu/components";
import { useAuth } from "@/hooks/useAuth";

const statuses = ["open", "in-progress", "pending", "resolved", "closed"];
const priorities = ["low", "medium", "high", "urgent"];
const label = (value: string) => value?.replace("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const priorityClass: Record<string, string> = { urgent: "text-[#a3483e]", high: "text-[#9b6a22]", medium: "text-[#9b6a22]", low: "text-[#666]" };

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || "Request failed"), { status: response.status });
  return payload;
}

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const manager = user?.role === "manager" || user?.role === "admin";
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState("");
  const { data, isLoading, error: fetchError } = useQuery<any>({ queryKey: ["/api/tickets", id], queryFn: () => request(`/api/tickets/${id}`), enabled: Boolean(id) });
  const { data: agents = [] } = useQuery<any[]>({ queryKey: ["/api/users"], queryFn: () => request("/api/users"), enabled: manager });
  const update = useMutation({
    mutationFn: (values: Record<string, unknown>) => request(`/api/tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }),
    onSuccess: () => { setError(""); queryClient.invalidateQueries({ queryKey: ["/api/tickets", id] }); queryClient.invalidateQueries({ queryKey: ["/api/tickets"] }); },
    onError: (cause: Error) => setError(cause.message),
  });
  const addComment = useMutation({
    mutationFn: () => request(`/api/tickets/${id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment: commentText }) }),
    onSuccess: () => { setCommentText(""); setError(""); queryClient.invalidateQueries({ queryKey: ["/api/tickets", id] }); },
    onError: (cause: Error) => setError(cause.message),
  });
  if (isLoading) return <div className="flex min-h-[100dvh] items-center justify-center bg-[#e0e0e0] p-8"><div className="h-48 w-full max-w-4xl animate-pulse rounded-2xl bg-[#d2d2d2]" /></div>;
  if (fetchError || !data) return <div className="flex min-h-[100dvh] items-center justify-center bg-[#e0e0e0] p-8"><div className="rounded-2xl bg-[#e0e0e0] p-8 text-center shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8]"><p className="text-[#a3483e]">{(fetchError as Error)?.message || "Ticket not found"}</p><Link href="/tickets" className="text-[#168d99]">Back to tickets</Link></div></div>;
  const changeStatus = (status: string) => {
    const nextResolution = resolution.trim() || data.resolution?.trim() || "";
    if ((status === "resolved" || status === "closed") && !nextResolution) { setError("Resolution is required when resolving or closing a ticket."); return; }
    update.mutate({ status, resolution: nextResolution || null });
  };
  const name = (person: any) => person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() || person.email : "—";
  return <div className="ff-admin-page flex min-h-[100dvh] bg-[#e0e0e0]"><Sidebar /><AdminPageShell className="flex-1 overflow-auto !min-h-0"><TopNav title={data.ticketNumber} subtitle="Ticket details" group="Workspace" /><div className="mx-auto max-w-5xl space-y-6 p-6">
    <Link href="/tickets" className="text-sm text-[#168d99]">← Back to tickets</Link>
    <Card className="p-6"><div className="flex flex-wrap justify-between gap-4"><div><h1 className="text-2xl font-bold">{data.title}</h1><p className="mt-3 whitespace-pre-wrap text-muted-foreground">{data.description}</p></div><div className="flex gap-2"><Select value={data.status} onValueChange={changeStatus}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{statuses.map((status) => <SelectItem value={status} key={status}>{label(status)}</SelectItem>)}</SelectContent></Select><Select value={data.priority} onValueChange={(priority) => update.mutate({ priority })}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{priorities.map((priority) => <SelectItem value={priority} key={priority}>{label(priority)}</SelectItem>)}</SelectContent></Select></div></div>
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><p><b>Category:</b> {label(data.category)}</p><p><b>Submitted by:</b> {data.submittedByName || "—"}</p><p><b>Assigned to:</b> {data.assignedToName || "Unassigned"}</p><p><b>Created:</b> {new Date(data.createdAt).toLocaleString()}</p><p><b>Updated:</b> {new Date(data.updatedAt).toLocaleString()}</p><p><b>Resolved:</b> {data.resolvedAt ? new Date(data.resolvedAt).toLocaleString() : "—"}</p></div>
      <div className="mt-4 flex flex-wrap gap-2"><Badge>{label(data.category)}</Badge><Badge className={priorityClass[data.priority]}>{label(data.priority)} priority</Badge></div>
    </Card>
    <section className="grid gap-6 md:grid-cols-2"><Card className="p-5"><h2 className="mb-3 font-semibold">Linked records</h2><p>Carrier: {data.carrier ? <Link className="text-[#168d99]" href={`/clients/${data.carrier.id}`}>{data.carrier.name}</Link> : "—"}</p><p>Broker: {data.broker ? <Link className="text-[#168d99]" href={`/brokers/${data.broker.id}`}>{data.broker.name}</Link> : "—"}</p><p>Invoice: {data.invoice ? <Link className="text-[#168d99]" href={`/invoices/${data.invoice.id}`}>{data.invoice.invoiceNumber}</Link> : "—"}</p>{manager && <div className="mt-4"><label className="text-sm font-medium">Assignment</label><Select value={data.assignedTo || "unassigned"} onValueChange={(assignedTo) => update.mutate({ assignedTo: assignedTo === "unassigned" ? null : assignedTo })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{agents.map((agent) => <SelectItem value={agent.id} key={agent.id}>{name(agent)}</SelectItem>)}</SelectContent></Select></div>}</Card><Card className="p-5"><h2 className="mb-3 font-semibold">Resolution</h2><Textarea value={resolution || data.resolution || ""} onChange={(event) => setResolution(event.target.value)} placeholder="Describe the resolution (required to resolve or close)" /><Button className="mt-3" disabled={update.isPending} onClick={() => update.mutate({ resolution: resolution.trim() || null })}>Save resolution</Button></Card></section>
    <Card className="p-6"><h2 className="mb-4 font-semibold">Comments</h2><NeuTable className="w-full"><NeuTableBody>{(data.comments || []).map((comment: any) => <NeuTableRow key={comment.id}><NeuTableCell><p className="whitespace-pre-wrap text-sm">{comment.comment}</p><p className="mt-2 text-xs text-[#888]">{comment.authorName || name(comment.author)} · {new Date(comment.createdAt).toLocaleString()}</p></NeuTableCell></NeuTableRow>)}</NeuTableBody></NeuTable><div className="mt-5 space-y-2"><Textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Add a comment…" /><Button disabled={addComment.isPending || !commentText.trim()} onClick={() => addComment.mutate()}>Add comment</Button></div></Card>
    {error && <p role="alert" className="rounded-xl bg-[#f0dfdc] p-3 text-sm text-[#a3483e] shadow-[inset_4px_4px_8px_#c8aaa7,inset_-4px_-4px_8px_#fff]">{error}</p>}
  </div></AdminPageShell></div>;
}