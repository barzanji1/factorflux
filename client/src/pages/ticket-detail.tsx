import { useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";

const statuses = ["open", "in-progress", "pending", "resolved", "closed"];
const priorities = ["low", "medium", "high", "urgent"];
const label = (value: string) => value?.replace("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const priorityClass: Record<string, string> = { urgent: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700", medium: "bg-yellow-100 text-yellow-700", low: "bg-gray-100 text-gray-700" };

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
  if (isLoading) return <div className="p-8">Loading ticket…</div>;
  if (fetchError || !data) return <div className="p-8"><p className="text-red-600">{(fetchError as Error)?.message || "Ticket not found"}</p><Link href="/tickets" className="text-primary">Back to tickets</Link></div>;
  const changeStatus = (status: string) => {
    const nextResolution = resolution.trim() || data.resolution?.trim() || "";
    if ((status === "resolved" || status === "closed") && !nextResolution) { setError("Resolution is required when resolving or closing a ticket."); return; }
    update.mutate({ status, resolution: nextResolution || null });
  };
  const name = (person: any) => person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() || person.email : "—";
  return <div className="flex h-screen bg-[hsl(var(--background))]"><Sidebar /><main className="flex-1 overflow-auto"><TopNav title={data.ticketNumber} subtitle="Ticket details" group="Workspace" /><div className="mx-auto max-w-5xl space-y-6 p-6">
    <Link href="/tickets" className="text-sm text-primary">← Back to tickets</Link>
    <section className="ff-card ff-ticket-surface p-6"><div className="flex flex-wrap justify-between gap-4"><div><h1 className="text-2xl font-bold">{data.title}</h1><p className="mt-3 whitespace-pre-wrap text-muted-foreground">{data.description}</p></div><div className="flex gap-2"><Select value={data.status} onValueChange={changeStatus}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{statuses.map((status) => <SelectItem value={status} key={status}>{label(status)}</SelectItem>)}</SelectContent></Select><Select value={data.priority} onValueChange={(priority) => update.mutate({ priority })}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{priorities.map((priority) => <SelectItem value={priority} key={priority}>{label(priority)}</SelectItem>)}</SelectContent></Select></div></div>
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><p><b>Category:</b> {label(data.category)}</p><p><b>Submitted by:</b> {data.submittedByName || "—"}</p><p><b>Assigned to:</b> {data.assignedToName || "Unassigned"}</p><p><b>Created:</b> {new Date(data.createdAt).toLocaleString()}</p><p><b>Updated:</b> {new Date(data.updatedAt).toLocaleString()}</p><p><b>Resolved:</b> {data.resolvedAt ? new Date(data.resolvedAt).toLocaleString() : "—"}</p></div>
      <div className="mt-4 flex flex-wrap gap-2"><Badge>{label(data.category)}</Badge><Badge className={priorityClass[data.priority]}>{label(data.priority)} priority</Badge></div>
    </section>
    <section className="grid gap-6 md:grid-cols-2"><div className="ff-card ff-ticket-surface p-5"><h2 className="mb-3 font-semibold">Linked records</h2><p>Carrier: {data.carrier ? <Link className="text-primary" href={`/clients/${data.carrier.id}`}>{data.carrier.name}</Link> : "—"}</p><p>Broker: {data.broker ? <Link className="text-primary" href={`/brokers/${data.broker.id}`}>{data.broker.name}</Link> : "—"}</p><p>Invoice: {data.invoice ? <Link className="text-primary" href={`/invoices/${data.invoice.id}`}>{data.invoice.invoiceNumber}</Link> : "—"}</p>{manager && <div className="mt-4"><label className="text-sm font-medium">Assignment</label><Select value={data.assignedTo || "unassigned"} onValueChange={(assignedTo) => update.mutate({ assignedTo: assignedTo === "unassigned" ? null : assignedTo })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{agents.map((agent) => <SelectItem value={agent.id} key={agent.id}>{name(agent)}</SelectItem>)}</SelectContent></Select></div>}</div><div className="ff-card ff-ticket-surface p-5"><h2 className="mb-3 font-semibold">Resolution</h2><Textarea value={resolution || data.resolution || ""} onChange={(event) => setResolution(event.target.value)} placeholder="Describe the resolution (required to resolve or close)" /><Button className="mt-3" disabled={update.isPending} onClick={() => update.mutate({ resolution: resolution.trim() || null })}>Save resolution</Button></div></section>
    <section className="ff-card ff-ticket-surface p-6"><h2 className="mb-4 font-semibold">Comments</h2><div className="space-y-3">{(data.comments || []).map((comment: any) => <article className="ff-ticket-comment bg-muted p-3" key={comment.id}><p className="whitespace-pre-wrap text-sm">{comment.comment}</p><p className="mt-2 text-xs text-muted-foreground">{comment.authorName || name(comment.author)} · {new Date(comment.createdAt).toLocaleString()}</p></article>)}</div><div className="mt-5 space-y-2"><Textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Add a comment…" /><Button disabled={addComment.isPending || !commentText.trim()} onClick={() => addComment.mutate()}>Add comment</Button></div></section>
    {error && <p className="ff-ticket-surface bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  </div></main></div>;
}