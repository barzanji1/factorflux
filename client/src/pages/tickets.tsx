import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";

const statuses = ["open", "in-progress", "pending", "resolved", "closed"];
const priorities = ["low", "medium", "high", "urgent"];
const categories = ["billing", "technical", "carrier", "broker", "document", "payroll", "other"];
const label = (value: string) => value.replace("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const priorityClass: Record<string, string> = {
  urgent: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700", low: "bg-gray-100 text-gray-700",
};

type Filters = { status: string; priority: string; category: string; assignedTo: string; from: string; to: string };
type TicketForm = { title: string; description: string; category: string; priority: string; carrierId: string; brokerId: string; invoiceId: string; assignedTo: string };

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Request failed");
  return payload;
}

export default function Tickets() {
  const { user } = useAuth();
  const managers = user?.role === "manager" || user?.role === "admin";
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ status: "", priority: "", category: "", assignedTo: "", from: "", to: "" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<TicketForm>({ title: "", description: "", category: "other", priority: "medium", carrierId: "", brokerId: "", invoiceId: "", assignedTo: "" });
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as string[][]);
  const { data: tickets = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/tickets", filters],
    queryFn: () => jsonRequest(`/api/tickets?${query}`),
  });
  const { data: summary } = useQuery<any>({ queryKey: ["/api/tickets/summary"], queryFn: () => jsonRequest("/api/tickets/summary") });
  const { data: agents = [] } = useQuery<any[]>({ queryKey: ["/api/users"], queryFn: () => jsonRequest("/api/users"), enabled: managers });
  const { data: carriers = [] } = useQuery<any[]>({ queryKey: ["/api/clients", { all: true }], queryFn: () => jsonRequest("/api/clients?all=true") });
  const { data: brokers = [] } = useQuery<any[]>({ queryKey: ["/api/brokers", { all: true }], queryFn: () => jsonRequest("/api/brokers?all=true") });
  const { data: invoices = [] } = useQuery<any[]>({ queryKey: ["/api/invoices", { all: true }], queryFn: () => jsonRequest("/api/invoices?all=true") });
  const create = useMutation({
    mutationFn: () => jsonRequest("/api/tickets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, carrierId: form.carrierId ? Number(form.carrierId) : null, brokerId: form.brokerId ? Number(form.brokerId) : null, invoiceId: form.invoiceId ? Number(form.invoiceId) : null, assignedTo: form.assignedTo || null }),
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/tickets"] }); setDialogOpen(false); },
    onError: (e: Error) => setError(e.message),
  });
  const setFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value === "all" ? "" : value }));
  const updateForm = (key: keyof TicketForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const people = (person: any) => person?.firstName || person?.lastName ? `${person.firstName || ""} ${person.lastName || ""}`.trim() : person?.email || "—";
  return (
    <div className="flex h-screen bg-[hsl(var(--background))]"><Sidebar /><div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <TopNav title="Tickets" subtitle="Support requests and issue resolution" group="Workspace" />
      <main className="flex-1 overflow-auto p-6"><div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">Tickets</h1><p className="text-sm text-muted-foreground">Track and resolve internal requests.</p></div><Button onClick={() => { setError(""); setDialogOpen(true); }}>New Ticket</Button></header>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Open", summary?.open], ["In Progress", summary?.inProgress], ["Pending", summary?.pending], ["Resolved Today", summary?.resolvedToday]].map(([title, value]) => <div className="rounded-xl border bg-card p-4" key={title as string}><p className="text-xs text-muted-foreground">{title}</p><p className="text-2xl font-bold">{value ?? 0}</p></div>)}</div>
        <div className="flex flex-wrap gap-3">{([["status", statuses], ["priority", priorities], ["category", categories]] as const).map(([key, values]) => <Select key={key} value={filters[key] || "all"} onValueChange={(value) => setFilter(key, value)}><SelectTrigger className="w-40"><SelectValue placeholder={label(key)} /></SelectTrigger><SelectContent><SelectItem value="all">All {label(key)}</SelectItem>{values.map((value) => <SelectItem value={value} key={value}>{label(value)}</SelectItem>)}</SelectContent></Select>)}{managers && <Select value={filters.assignedTo || "all"} onValueChange={(value) => setFilter("assignedTo", value)}><SelectTrigger className="w-48"><SelectValue placeholder="Assigned agent" /></SelectTrigger><SelectContent><SelectItem value="all">All agents</SelectItem>{agents.map((agent) => <SelectItem value={agent.id} key={agent.id}>{people(agent)}</SelectItem>)}</SelectContent></Select>}<Input type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} className="w-40" /><Input type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} className="w-40" /></div>
        <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Ticket #</th><th>Title</th><th>Category</th><th>Priority</th><th>Status</th><th>Submitted by</th><th>Assigned to</th><th>Created</th><th>Actions</th></tr></thead><tbody>{isLoading ? <tr><td className="p-6" colSpan={9}>Loading…</td></tr> : tickets.map((ticket) => <tr className="cursor-pointer border-b last:border-0 hover:bg-muted/50" key={ticket.id} onClick={() => window.location.assign(`/tickets/${ticket.id}`)}><td className="p-3 font-mono text-primary">{ticket.ticketNumber}</td><td className="font-medium">{ticket.title}</td><td><Badge variant="outline">{label(ticket.category)}</Badge></td><td><Badge className={priorityClass[ticket.priority]}>{label(ticket.priority)}</Badge></td><td><Badge variant="outline">{label(ticket.status)}</Badge></td><td>{ticket.submittedByName || "—"}</td><td>{ticket.assignedToName || "Unassigned"}</td><td>{ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString() : "—"}</td><td><Link href={`/tickets/${ticket.id}`} className="text-primary hover:underline" onClick={(event) => event.stopPropagation()}>View</Link></td></tr>)}</tbody></table></div>
      </div></main>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>New Ticket</DialogTitle></DialogHeader><div className="space-y-4"><Input placeholder="Title *" value={form.title} onChange={(event) => updateForm("title", event.target.value)} /><Textarea placeholder="Description *" rows={5} value={form.description} onChange={(event) => updateForm("description", event.target.value)} /><div className="grid gap-3 sm:grid-cols-2">{([["category", categories], ["priority", priorities]] as const).map(([key, values]) => <Select key={key} value={form[key]} onValueChange={(value) => updateForm(key, value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{values.map((value) => <SelectItem value={value} key={value}>{label(value)}</SelectItem>)}</SelectContent></Select>)}</div>{([["carrierId", carriers, "Carrier"], ["brokerId", brokers, "Broker"], ["invoiceId", invoices, "Invoice"]] as const).map(([key, values, title]) => <Select key={key} value={form[key] || "none"} onValueChange={(value) => updateForm(key, value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder={`Linked ${title} (optional)`} /></SelectTrigger><SelectContent><SelectItem value="none">No linked {title.toLowerCase()}</SelectItem>{values.map((item: any) => <SelectItem value={String(item.id)} key={item.id}>{item.name || item.invoiceNumber || `#${item.id}`}</SelectItem>)}</SelectContent></Select>)}{managers && <Select value={form.assignedTo || "none"} onValueChange={(value) => updateForm("assignedTo", value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Assign agent (optional)" /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{agents.map((agent) => <SelectItem value={agent.id} key={agent.id}>{people(agent)}</SelectItem>)}</SelectContent></Select>}{error && <p className="text-sm text-red-600">{error}</p>}<Button className="w-full" disabled={create.isPending || !form.title.trim() || !form.description.trim()} onClick={() => { setError(""); create.mutate(); }}>{create.isPending ? "Creating…" : "Create Ticket"}</Button></div></DialogContent></Dialog>
    </div></div>
  );
}