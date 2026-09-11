import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";

type CalendarEvent = {
  id?: string | number; title: string; description?: string; date?: string;
  startDate?: string; endDate?: string; startTime?: string; endTime?: string;
  allDay?: boolean; color?: string; recurrence?: string; assignedTo?: string;
  carrierId?: string; brokerId?: string; invoiceId?: string; recurrenceEndAt?: string;
  eventType?: string; status?: string;
};
type ViewMode = "month" | "week" | "day";
const colors = ["#098b9f", "#2563eb", "#7c3aed", "#db2777", "#d97706", "#16a34a"];
const typeColors: Record<string, string> = { meeting: "#2563eb", deadline: "#dc2626", followup: "#ea580c", reminder: "#ca8a04", holiday: "#6b7280", closure: "#6b7280" };
const typeLabels: Record<string, string> = { meeting: "Meeting", deadline: "Deadline", followup: "Follow-up", reminder: "Reminder", holiday: "Holiday", closure: "Closure" };
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const labelDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function eventDate(e: CalendarEvent) {
  return (e.date || e.startDate || (e as any).occurrenceStart || (e as any).startAt || "").slice(0, 10);
}
function timeLabel(e: CalendarEvent) {
  if (e.allDay) return "All day";
  return [e.startTime || (e as any).occurrenceStart?.slice?.(11, 16) || (e as any).startAt?.slice?.(11, 16), e.endTime || (e as any).occurrenceEnd?.slice?.(11, 16) || (e as any).endAt?.slice?.(11, 16)].filter(Boolean).join(" – ") || "All day";
}

export default function CalendarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [cursor, setCursor] = useState(dayStart(new Date()));
  const [view, setView] = useState<ViewMode>("month");
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const query = useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar/events", cursor.getFullYear(), cursor.getMonth() + 1, scope],
    queryFn: async () => {
      const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const params = new URLSearchParams({ from: isoDate(from), to: isoDate(to), startDate: isoDate(from), endDate: isoDate(to), scope });
      if (scope === "mine" && user?.id) params.set("userId", user.id);
      const r = await fetch(`/api/calendar/events?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Unable to load calendar events");
      const data = await r.json();
      return Array.isArray(data) ? data : data.events || [];
    },
  });
  const users = useQuery<any[]>({ queryKey: ["/api/users"] });
  const carriers = useQuery<any[]>({ queryKey: ["/api/clients", { all: true }] });
  const brokers = useQuery<any[]>({ queryKey: ["/api/brokers", { all: true }] });
  const invoices = useQuery<any[]>({ queryKey: ["/api/invoices", { all: true }] });
  const events = Array.isArray(query.data) ? query.data : [];
  const save = useMutation({
    mutationFn: async (data: CalendarEvent) => {
      const method = data.id ? "PATCH" : "POST";
      const url = data.id ? `/api/calendar/events/${data.id}` : "/api/calendar/events";
      const startAt = `${eventDate(data)}T${data.allDay ? "00:00" : (data.startTime || "09:00")}:00`;
      const endAt = `${(data.endDate || eventDate(data))}T${data.allDay ? "23:59" : (data.endTime || "10:00")}:00`;
      const { date, startDate, endDate, startTime, endTime, color, carrierId, occurrenceStart, occurrenceEnd, ...rest } = data as any;
      await apiRequest(method, url, { ...rest, startAt, endAt, color, carrierId: carrierId ? Number(carrierId) : null, assignedTo: data.assignedTo || user?.id });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/calendar/events"] }); setDialogOpen(false); toast({ title: "Event saved", description: "Your calendar event was saved." }); },
    onError: (error: Error) => toast({ title: "Unable to save event", description: error.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: string | number) => apiRequest("DELETE", `/api/calendar/events/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/calendar/events"] }); setDialogOpen(false); toast({ title: "Event deleted" }); },
    onError: (error: Error) => toast({ title: "Unable to delete event", description: error.message, variant: "destructive" }),
  });

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);
  const visibleDays = view === "month" ? days : Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => {
    const d = new Date(cursor); d.setDate(cursor.getDate() - (view === "week" ? cursor.getDay() : 0) + i); return d;
  });
  const openCreate = (date = cursor) => {
    setEditing({ title: "", startDate: isoDate(date), endDate: isoDate(date), startTime: "09:00", endTime: "10:00", eventType: "meeting", status: "scheduled", color: typeColors.meeting, recurrence: "none", assignedTo: user?.id });
    setDialogOpen(true);
  };
  const move = (n: number) => {
    const d = new Date(cursor);
    if (view === "day") d.setDate(d.getDate() + n);
    else if (view === "week") d.setDate(d.getDate() + n * 7);
    else d.setMonth(d.getMonth() + n);
    setCursor(d);
  };

  return (
    <AppShell title="Calendar" subtitle="Plan appointments, follow-ups, and team work" group="Workspace">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCursor(dayStart(new Date()))}>Today</Button>
            <Button variant="ghost" size="icon" onClick={() => move(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => move(1)}><ChevronRight className="h-4 w-4" /></Button>
            <h2 className="ml-1 text-lg font-semibold">{view === "day" ? cursor.toLocaleDateString("en-US", { dateStyle: "full" }) : labelDate(cursor)}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(user?.role === "manager" || user?.role === "admin") && (
              <div className="flex rounded-md border bg-white p-0.5 dark:bg-slate-900">
                <button className={`px-3 py-1 text-xs ${scope === "mine" ? "rounded bg-[#dff5f6] font-semibold" : ""}`} onClick={() => setScope("mine")}>My Schedule</button>
                <button className={`px-3 py-1 text-xs ${scope === "team" ? "rounded bg-[#dff5f6] font-semibold" : ""}`} onClick={() => setScope("team")}>Team Schedule</button>
              </div>
            )}
            <div className="flex rounded-md border bg-white p-0.5 dark:bg-slate-900">
              {(["month", "week", "day"] as ViewMode[]).map(v => <button key={v} onClick={() => setView(v)} className={`px-3 py-1 text-xs capitalize ${view === v ? "rounded bg-slate-200 font-semibold dark:bg-slate-700" : ""}`}>{v}</button>)}
            </div>
            <Button size="sm" onClick={() => openCreate()}><Plus className="mr-1 h-4 w-4" />New event</Button>
          </div>
        </div>
        {query.isLoading && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">Loading calendar events…</div>}
        {query.isError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Unable to load calendar events. Please try again.</div>}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]">
          {view === "month" && <div className="grid grid-cols-7 border-b text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(x => <div className="p-2" key={x}>{x}</div>)}</div>}
          <div className={view === "month" ? "grid grid-cols-7" : "grid grid-cols-1 md:grid-cols-7"}>
            {visibleDays.map(d => {
              const dayEvents = events.filter(e => eventDate(e) === isoDate(d));
              return <div key={isoDate(d)} onDoubleClick={() => openCreate(d)} className={`min-h-[130px] border-b border-r border-slate-100 p-2 dark:border-slate-800 ${view !== "month" ? "min-h-[430px]" : ""} ${d.getMonth() !== cursor.getMonth() && view === "month" ? "bg-slate-50/60 text-slate-400" : ""}`}>
                <button onClick={() => openCreate(d)} className="mb-1 text-xs font-semibold hover:text-[#098b9f]">{d.getDate()}</button>
                <div className="space-y-1">{dayEvents.map(e => <button key={`${e.id}-${(e as any).occurrenceStart}`} onClick={() => { setEditing({ ...e }); setDialogOpen(true); }} className="block w-full truncate rounded px-1.5 py-1 text-left text-[11px] text-white" style={{ backgroundColor: e.color || colors[0] }} title={e.description}>{!e.allDay && <span className="mr-1 opacity-80">{timeLabel(e).split(" ")[0]}</span>}{e.title}</button>)}</div>
              </div>;
            })}
          </div>
        </div>
      </div>
      <EventDialog event={editing} open={dialogOpen} setOpen={setDialogOpen} users={users.data || []} carriers={carriers.data || []} brokers={brokers.data || []} invoices={invoices.data || []} canAssign={user?.role === "manager" || user?.role === "admin"} saving={save.isPending}
        onSave={(e) => save.mutate(e)} onDelete={(id) => remove.mutate(id)} />
    </AppShell>
  );
}

function EventDialog({ event, open, setOpen, users, carriers, brokers, invoices, canAssign, saving, onSave, onDelete }: { event: CalendarEvent | null; open: boolean; setOpen: (v: boolean) => void; users: any[]; carriers: any[]; brokers: any[]; invoices: any[]; canAssign: boolean; saving: boolean; onSave: (e: CalendarEvent) => void; onDelete: (id: string | number) => void }) {
  const [form, setForm] = useState<CalendarEvent | null>(event);
  useEffect(() => { if (open) setForm(event); }, [event, open]);
  if (form && !open) return null;
  const update = (key: keyof CalendarEvent, value: any) => setForm(f => f ? { ...f, [key]: value } : f);
  return <Dialog open={open} onOpenChange={v => { setOpen(v); if (v) setForm(event); }}><DialogContent className="max-w-2xl overflow-y-auto">
    <DialogHeader><DialogTitle>{form?.id ? "Edit calendar event" : "New calendar event"}</DialogTitle></DialogHeader>
    {form && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="sm:col-span-2 text-xs font-semibold">Title<Input value={form.title} onChange={e => update("title", e.target.value)} required /></label>
      <label className="sm:col-span-2 text-xs font-semibold">Description<Textarea value={form.description || ""} onChange={e => update("description", e.target.value)} /></label>
       <label className="text-xs font-semibold">Event type<select className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.eventType || "meeting"} onChange={e => { update("eventType", e.target.value); update("color", typeColors[e.target.value] || colors[0]); }}>{Object.keys(typeColors).map(x => <option key={x} value={x}>{typeLabels[x]}</option>)}</select></label>
      <label className="text-xs font-semibold">Status<select className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.status || "scheduled"} onChange={e => update("status", e.target.value)}>{["scheduled", "completed", "cancelled"].map(x => <option key={x}>{x}</option>)}</select></label>
      <label className="text-xs font-semibold">Start date<Input type="date" value={form.startDate || eventDate(form)} onChange={e => update("startDate", e.target.value)} /></label>
      <label className="text-xs font-semibold">End date<Input type="date" value={form.endDate || form.startDate || eventDate(form)} onChange={e => update("endDate", e.target.value)} /></label>
      <label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" checked={!!form.allDay} onChange={e => update("allDay", e.target.checked)} /> All day</label>
      {!form.allDay && <><label className="text-xs font-semibold">Start time<Input type="time" value={form.startTime || ""} onChange={e => update("startTime", e.target.value)} /></label><label className="text-xs font-semibold">End time<Input type="time" value={form.endTime || ""} onChange={e => update("endTime", e.target.value)} /></label></>}
      <label className="text-xs font-semibold">Recurrence<select className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.recurrence || "none"} onChange={e => update("recurrence", e.target.value)}>{["none", "daily", "weekly", "monthly"].map(x => <option key={x}>{x}</option>)}</select></label>
       {form.recurrence !== "none" && <label className="text-xs font-semibold">Repeat until (optional)<Input type="date" value={form.recurrenceEndAt?.slice(0, 10) || ""} onChange={e => update("recurrenceEndAt", e.target.value ? `${e.target.value}T23:59:59` : undefined)} /></label>}
      <label className="text-xs font-semibold">Color<select className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.color || colors[0]} onChange={e => update("color", e.target.value)}>{colors.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
      {canAssign && <label className="text-xs font-semibold">Assigned to<select className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.assignedTo || ""} onChange={e => update("assignedTo", e.target.value)}><option value="">Unassigned</option>{users.map(u => <option key={u.id} value={u.id}>{u.name || `${u.firstName || ""} ${u.lastName || ""}` || u.email}</option>)}</select></label>}
      <label className="text-xs font-semibold">Carrier<select className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.carrierId || (form as any).clientId || ""} onChange={e => update("carrierId", e.target.value)}><option value="">None</option>{carriers.map(c => <option key={c.id} value={c.id}>{c.name || c.companyName || `Carrier ${c.id}`}</option>)}</select></label>
      <label className="text-xs font-semibold">Broker<select className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.brokerId || ""} onChange={e => update("brokerId", e.target.value)}><option value="">None</option>{brokers.map(b => <option key={b.id} value={b.id}>{b.name || b.companyName || `Broker ${b.id}`}</option>)}</select></label>
       <label className="text-xs font-semibold">Invoice<select className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.invoiceId || ""} onChange={e => update("invoiceId", e.target.value)}><option value="">None</option>{invoices.map(i => <option key={i.id} value={i.id}>{i.invoiceNumber || `Invoice ${i.id}`}</option>)}</select></label>
    </div>}
    <DialogFooter><div className="flex w-full justify-between">{form?.id ? <Button variant="destructive" size="sm" onClick={() => onDelete(form.id!)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button> : <span /> }<div className="flex gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving || !form?.title || !(form?.startDate || eventDate(form || {})) || !(form?.endDate || form?.startDate)} onClick={() => form && onSave(form)}>{saving ? "Saving…" : "Save event"}</Button></div></div></DialogFooter>
  </DialogContent></Dialog>;
}