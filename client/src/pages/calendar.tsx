import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PageInsights } from "@/components/PageInsights";
import { apiRequest } from "@/lib/queryClient";
import {
  NeuBadge,
  NeuButton,
  NeuCard,
  NeuInput,
  NeuSelect,
  NeuTab,
  NeuTabList,
  NeuTabs,
} from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";

type CalendarEvent = {
  id?: string | number; title: string; description?: string; date?: string;
  startDate?: string; endDate?: string; startTime?: string; endTime?: string;
  allDay?: boolean; color?: string; recurrence?: string; assignedTo?: string;
  carrierId?: string; brokerId?: string; invoiceId?: string; recurrenceEndAt?: string;
  eventType?: string; status?: string;
};
type ViewMode = "month" | "week" | "day";
const colors = ["#098b9f", "#2563eb", "#7c3aed", "#db2777", "#d97706", "#16a34a"];
const typeColors: Record<string, string> = {
  meeting: "#2563eb", deadline: "#dc2626", followup: "#098b9f", reminder: "#ca8a04",
  holiday: "#6b7280", closure: "#6b7280",
};
const typeLabels: Record<string, string> = {
  meeting: "Meeting", deadline: "Deadline", followup: "Follow-up", reminder: "Reminder",
  holiday: "Holiday", closure: "Closure", chargeback: "Chargeback", funding: "Funding",
};
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

const eventTint = (event: CalendarEvent) => event.color || ({ chargeback: "#dc2626", funding: "#16a34a" } as Record<string, string>)[event.eventType || ""] || typeColors[event.eventType || ""] || colors[0];
const eventTypeLabel = (event: CalendarEvent) =>
  typeLabels[event.eventType || ""] || (event.eventType ? event.eventType.replace(/[-_]/g, " ") : "Event");

function CalendarEventChip({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const color = eventTint(event);
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full truncate rounded-md border-l-[3px] px-2 py-1 text-left text-[11px] font-semibold leading-4 transition-[transform,background-color] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]"
      style={{ color, borderLeftColor: color, backgroundColor: `${color}18` }}
      title={`${event.title} · ${timeLabel(event)}`}
    >
      {!event.allDay && <span className="mr-1 font-medium opacity-75">{timeLabel(event).split(" ")[0]}</span>}
      {event.title}
    </button>
  );
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
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
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
  const showEvent = (event: CalendarEvent) => { setEditing({ ...event }); setDialogOpen(true); };

  return (
    <AppShell title="Calendar" subtitle="Plan appointments, follow-ups, and team work" group="Workspace" neu>
      <div className="space-y-5">
        <PageInsights entity="calendar" title="Calendar activity" />
        <NeuCard className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <NeuButton onClick={() => setCursor(dayStart(new Date()))} className="min-h-10 rounded-full px-4 text-xs text-[#27aab8]">Today</NeuButton>
            <NeuButton aria-label="Previous period" onClick={() => move(-1)} className="!min-h-10 !h-10 !w-10 !rounded-full !p-0 hover:!text-[#27aab8]">
              <ChevronLeft className="h-4 w-4" />
            </NeuButton>
            <NeuButton aria-label="Next period" onClick={() => move(1)} className="!min-h-10 !h-10 !w-10 !rounded-full !p-0 hover:!text-[#27aab8]">
              <ChevronRight className="h-4 w-4" />
            </NeuButton>
            <h2 className="ml-1 truncate text-base font-bold tracking-tight text-[#555] sm:ml-3 sm:text-xl">
              {view === "day" ? cursor.toLocaleDateString("en-US", { dateStyle: "full" }) : labelDate(cursor)}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {(user?.role === "manager" || user?.role === "admin") && (
              <NeuTabs value={scope} onValueChange={value => setScope(value as "mine" | "team")} className="w-auto">
                <NeuTabList className="gap-1 rounded-full p-1.5">
                  <NeuTab value="mine" className="!min-h-9 rounded-full px-3 text-xs">My Schedule</NeuTab>
                  <NeuTab value="team" className="!min-h-9 rounded-full px-3 text-xs">Team Schedule</NeuTab>
                </NeuTabList>
              </NeuTabs>
            )}
            <NeuTabs value={view} onValueChange={value => setView(value as ViewMode)} className="w-auto">
              <NeuTabList aria-label="Calendar view" className="gap-1 rounded-full p-1.5">
                {(["month", "week", "day"] as ViewMode[]).map(v =>
                  <NeuTab key={v} value={v} className="!min-h-9 rounded-full px-4 text-xs capitalize">{v}</NeuTab>,
                )}
              </NeuTabList>
            </NeuTabs>
            <NeuButton variant="accent" onClick={() => openCreate()} className="min-h-10 rounded-full px-4">
              <Plus className="h-4 w-4" /> Add event
            </NeuButton>
          </div>
        </NeuCard>

        {query.isLoading && (
          <NeuCard aria-label="Loading calendar events" className="overflow-hidden p-3">
            <div className="grid grid-cols-7 gap-3" aria-hidden="true">
              {Array.from({ length: view === "month" ? 14 : 7 }, (_, index) =>
                <div key={index} className="min-h-24 animate-pulse rounded-xl bg-[#d4d4d4]" />,
              )}
            </div>
          </NeuCard>
        )}
        {query.isError && (
          <NeuNotice severity="block" role="alert" className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-[#8b4545]">Calendar couldn’t load</p>
              <p className="mt-1 text-sm text-[#777]">Your events are still safe. Try loading them again.</p>
            </div>
            <NeuButton onClick={() => query.refetch()} className="min-h-10 px-4">Try again</NeuButton>
          </NeuNotice>
        )}
        {!query.isLoading && !query.isError && (
          <NeuCard className="overflow-hidden p-2 sm:p-3">
            {view === "month" && (
              <div className="grid grid-cols-7 border-b border-[#c9c9c9] text-center">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day =>
                  <div key={day} className="px-1 py-3 text-[10px] font-bold uppercase tracking-[0.13em] text-[#888] sm:py-4 sm:text-[11px]">{day}</div>,
                )}
              </div>
            )}
            <div className={view === "month" ? "grid grid-cols-7" : view === "week" ? "grid grid-cols-1 divide-y divide-[#c9c9c9] md:grid-cols-7 md:divide-x md:divide-y-0" : "grid grid-cols-1"}>
              {visibleDays.map(d => {
                const dateKey = isoDate(d);
                const dayEvents = events.filter(event => eventDate(event) === dateKey);
                const outsideMonth = d.getMonth() !== cursor.getMonth() && view === "month";
                const today = dateKey === isoDate(dayStart(new Date()));
                const expanded = expandedDate === dateKey;
                const shownEvents = view === "month" && !expanded ? dayEvents.slice(0, 3) : dayEvents;
                return (
                  <div
                    key={dateKey}
                    onDoubleClick={() => openCreate(d)}
                    className={`min-w-0 border-b border-r border-[#c9c9c9]/75 p-1.5 shadow-[inset_2px_2px_4px_#c8c8c8,inset_-2px_-2px_4px_#f4f4f4] sm:p-2.5 ${view === "month" ? "min-h-[112px] sm:min-h-[146px]" : view === "week" ? "min-h-[240px] md:min-h-[430px]" : "min-h-[430px]"} ${outsideMonth ? "bg-[#d9d9d9]/65" : ""}`}
                  >
                    <div className={`mb-2 flex items-center ${view === "month" ? "justify-between" : "justify-between border-b border-[#c9c9c9]/70 pb-2"}`}>
                      <div className="flex min-w-0 items-center gap-2">
                        {view !== "month" && <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#999]">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>}
                        <button
                          type="button"
                          onClick={() => openCreate(d)}
                          aria-label={`Add event on ${d.toLocaleDateString("en-US", { dateStyle: "full" })}`}
                          className={`grid h-7 min-w-7 place-items-center rounded-full text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8] ${today ? "bg-[#27aab8] text-white ring-2 ring-[#27aab8]/25" : outsideMonth ? "text-[#aaa] hover:text-[#27aab8]" : "text-[#666] hover:text-[#27aab8]"}`}
                        >
                          {d.getDate()}
                        </button>
                        {view !== "month" && <span className="truncate text-xs font-semibold text-[#777]">{d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>}
                      </div>
                      {view === "month" && dayEvents.length > 0 && <span className="text-[10px] tabular-nums text-[#999]">{dayEvents.length}</span>}
                    </div>
                    <div className={`space-y-1.5 ${view === "month" ? "" : "space-y-2"}`}>
                      {shownEvents.map(event => view === "month"
                        ? <CalendarEventChip key={`${event.id}-${(event as any).occurrenceStart}`} event={event} onClick={() => showEvent(event)} />
                        : <button key={`${event.id}-${(event as any).occurrenceStart}`} type="button" onClick={() => showEvent(event)} className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]">
                            <NeuCard className="border-l-[4px] !rounded-xl p-3 transition-[transform] hover:-translate-y-px" style={{ borderLeftColor: eventTint(event) }}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-[#444]">{event.title}</span>
                                <span className="text-[11px] font-medium text-[#888]">{timeLabel(event)}</span>
                              </div>
                              {event.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#888]">{event.description}</p>}
                              <NeuBadge tone="neutral" className="mt-2 px-2 py-0.5 text-[10px]">{eventTypeLabel(event)}</NeuBadge>
                            </NeuCard>
                          </button>,
                      )}
                      {view === "month" && dayEvents.length > 3 && (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Show fewer" : "Show"} events for ${d.toLocaleDateString("en-US", { dateStyle: "full" })}`}
                          onClick={() => setExpandedDate(expanded ? null : dateKey)}
                          className="rounded px-1.5 py-1 text-[10px] font-semibold text-[#168b96] hover:bg-[#27aab8]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]"
                        >
                          {expanded ? "Show less" : `+${dayEvents.length - 3} more`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </NeuCard>
        )}
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
  const displayName = (records: any[], id?: string | number, fallback = "") => {
    if (!id) return "";
    const record = records.find(item => String(item.id) === String(id));
    return record?.name || record?.companyName || record?.invoiceNumber || [record?.firstName, record?.lastName].filter(Boolean).join(" ") || fallback || `${id}`;
  };
  const assignedName = displayName(users, form?.assignedTo);
  const related = [
    form?.invoiceId && { label: displayName(invoices, form.invoiceId, `Invoice ${form.invoiceId}`), href: `/invoices/${form.invoiceId}`, prefix: "Invoice" },
    form?.carrierId && { label: displayName(carriers, form.carrierId, `Carrier ${form.carrierId}`), href: `/clients/${form.carrierId}`, prefix: "Carrier" },
    (form?.brokerId || (form as any)?.broker_id) && { label: displayName(brokers, form?.brokerId || (form as any).broker_id, `Broker ${form?.brokerId || (form as any).broker_id}`), href: `/brokers/${form?.brokerId || (form as any).broker_id}`, prefix: "Broker" },
  ].filter(Boolean) as { label: string; href: string; prefix: string }[];
  const fieldClass = "block space-y-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#777]";
  const selectClass = "mt-1";
  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (v) setForm(event); }}>
      <DialogContent showCloseButton={false} className="calendar-neu-dialog ff-card !max-w-2xl !gap-5 !rounded-3xl !border-0 !bg-[#e0e0e0] !p-4 !text-[#333] !shadow-[9px_9px_18px_#b8b8b8,-9px_-9px_18px_#ffffff] sm:!p-6">
        <DialogHeader className="pr-10">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#27aab8]">{form?.id ? "Calendar event" : "Plan something"}</p>
          <DialogTitle className="!text-xl !font-bold !tracking-tight !text-[#444]">{form?.id ? "Edit calendar event" : "New calendar event"}</DialogTitle>
        </DialogHeader>
        <DialogClose asChild>
          <NeuButton aria-label="Close event dialog" className="absolute right-4 top-4 !min-h-9 !h-9 !w-9 !rounded-full !p-0 hover:!text-[#27aab8]">
            <X className="h-4 w-4" />
          </NeuButton>
        </DialogClose>
        {form && (
          <div className="max-h-[calc(100dvh-13rem)] space-y-4 overflow-y-auto px-1 pb-1">
            {form.id && (
              <NeuCard pressed className="space-y-3 rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-base font-bold text-[#444]">{form.title || "Untitled event"}</h3>
                    <p className="mt-1 text-xs font-medium text-[#888]">{form.startDate || eventDate(form)}{form.endDate && form.endDate !== (form.startDate || eventDate(form)) ? ` – ${form.endDate}` : ""} <span className="mx-1 text-[#bbb]">·</span> {timeLabel(form)}</p>
                  </div>
                  <NeuBadge tone="accent" className="shrink-0">{eventTypeLabel(form)}</NeuBadge>
                </div>
                {form.description && <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#666]">{form.description}</p>}
                {assignedName && <p className="text-xs text-[#888]">Assigned to <span className="font-semibold text-[#666]">{assignedName}</span></p>}
                {related.length > 0 && <div className="flex flex-wrap gap-2">{related.map(item =>
                  <Link key={item.href} href={item.href} className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]">
                    <NeuBadge tone="neutral"><span className="mr-1 text-[#999]">{item.prefix}</span>{item.label}</NeuBadge>
                  </Link>,
                )}</div>}
              </NeuCard>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={`${fieldClass} sm:col-span-2`}>Title
                <NeuInput value={form.title} onChange={e => update("title", e.target.value)} required className="!normal-case !tracking-normal" />
              </label>
              <label className={`${fieldClass} sm:col-span-2`}>Description
                <textarea value={form.description || ""} onChange={e => update("description", e.target.value)} rows={3} className="mt-1 w-full resize-y rounded-xl border-0 bg-[#e0e0e0] px-4 py-3 text-sm font-normal normal-case tracking-normal text-[#333] shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff] placeholder:text-[#888] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]" />
              </label>
              <label className={fieldClass}>Event type
                <NeuSelect className={selectClass} value={form.eventType || "meeting"} onChange={e => { update("eventType", e.target.value); update("color", typeColors[e.target.value] || colors[0]); }}>
                  {Object.keys(typeColors).map(x => <option key={x} value={x}>{typeLabels[x]}</option>)}
                </NeuSelect>
              </label>
              <label className={fieldClass}>Status
                <NeuSelect className={selectClass} value={form.status || "scheduled"} onChange={e => update("status", e.target.value)}>
                  {["scheduled", "completed", "cancelled"].map(x => <option key={x}>{x}</option>)}
                </NeuSelect>
              </label>
              <label className={fieldClass}>Start date
                <NeuInput type="date" value={form.startDate || eventDate(form)} onChange={e => update("startDate", e.target.value)} />
              </label>
              <label className={fieldClass}>End date
                <NeuInput type="date" value={form.endDate || form.startDate || eventDate(form)} onChange={e => update("endDate", e.target.value)} />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-[#666]">
                <input type="checkbox" checked={!!form.allDay} onChange={e => update("allDay", e.target.checked)} className="h-4 w-4 accent-[#27aab8]" /> All day
              </label>
              {!form.allDay && <>
                <label className={fieldClass}>Start time
                  <NeuInput type="time" value={form.startTime || ""} onChange={e => update("startTime", e.target.value)} />
                </label>
                <label className={fieldClass}>End time
                  <NeuInput type="time" value={form.endTime || ""} onChange={e => update("endTime", e.target.value)} />
                </label>
              </>}
              <label className={fieldClass}>Recurrence
                <NeuSelect className={selectClass} value={form.recurrence || "none"} onChange={e => update("recurrence", e.target.value)}>
                  {["none", "daily", "weekly", "monthly"].map(x => <option key={x}>{x}</option>)}
                </NeuSelect>
              </label>
              {form.recurrence !== "none" && <label className={fieldClass}>Repeat until (optional)
                <NeuInput type="date" value={form.recurrenceEndAt?.slice(0, 10) || ""} onChange={e => update("recurrenceEndAt", e.target.value ? `${e.target.value}T23:59:59` : undefined)} />
              </label>}
              <label className={fieldClass}>Color
                <NeuSelect className={selectClass} value={form.color || colors[0]} onChange={e => update("color", e.target.value)}>
                  {colors.map(x => <option key={x} value={x}>{x}</option>)}
                </NeuSelect>
              </label>
              {canAssign && <label className={fieldClass}>Assigned to
                <NeuSelect className={selectClass} value={form.assignedTo || ""} onChange={e => update("assignedTo", e.target.value)}>
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name || `${u.firstName || ""} ${u.lastName || ""}` || u.email}</option>)}
                </NeuSelect>
              </label>}
              <label className={fieldClass}>Carrier
                <NeuSelect className={selectClass} value={form.carrierId || (form as any).clientId || ""} onChange={e => update("carrierId", e.target.value)}>
                  <option value="">None</option>
                  {carriers.map(c => <option key={c.id} value={c.id}>{c.name || c.companyName || `Carrier ${c.id}`}</option>)}
                </NeuSelect>
              </label>
              <label className={fieldClass}>Broker
                <NeuSelect className={selectClass} value={form.brokerId || ""} onChange={e => update("brokerId", e.target.value)}>
                  <option value="">None</option>
                  {brokers.map(b => <option key={b.id} value={b.id}>{b.name || b.companyName || `Broker ${b.id}`}</option>)}
                </NeuSelect>
              </label>
              <label className={fieldClass}>Invoice
                <NeuSelect className={selectClass} value={form.invoiceId || ""} onChange={e => update("invoiceId", e.target.value)}>
                  <option value="">None</option>
                  {invoices.map(i => <option key={i.id} value={i.id}>{i.invoiceNumber || `Invoice ${i.id}`}</option>)}
                </NeuSelect>
              </label>
            </div>
          </div>
        )}
        <DialogFooter className="!flex-row !justify-between border-t border-[#c9c9c9]/70 pt-4">
          {form?.id ? <NeuButton disabled={saving} onClick={() => onDelete(form.id!)} className="min-h-10 px-3 text-[#a45050]"><Trash2 className="h-4 w-4" />Delete</NeuButton> : <span />}
          <div className="flex gap-2">
            <NeuButton onClick={() => setOpen(false)} className="min-h-10 px-4">Cancel</NeuButton>
            <NeuButton variant="accent" disabled={saving || !form?.title || !(form?.startDate || eventDate(form || {})) || !(form?.endDate || form?.startDate)} onClick={() => form && onSave(form)} className="min-h-10 px-4">
              {saving ? "Saving…" : "Save event"}
            </NeuButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
