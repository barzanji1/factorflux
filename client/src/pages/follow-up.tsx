import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Clock, Plus, Search, Calendar, AlertCircle, CheckCircle, User, FileText,
  Mail, Zap, CheckCheck, RefreshCw, ChevronDown, ChevronUp, Ban, SkipForward,
  RotateCcw, Settings2, Pause, Play, Send,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

const followUpSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]),
  dueDate: z.string().min(1, "Due date is required"),
  status: z.enum(["pending", "in-progress", "completed"]).default("pending"),
});

interface CadenceConfig {
  sendImmediately: boolean;
  sendOnDueDate: boolean;
  overdueIntervals: number[];
  weeklyCount: number;
  paused: boolean;
}

interface FollowUp {
  id: number;
  clientId: number;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high";
  dueDate: string;
  status: "pending" | "in-progress" | "completed";
  createdAt: string;
  updatedAt: string;
  client?: { id: number; name: string; email: string };
}

interface BrokerFollowUp {
  id: number;
  invoiceId: number;
  clientId: number | null;
  triggerType: "auto" | "manual";
  triggerStatus: string;
  subject: string;
  body: string;
  status: "pending" | "sent" | "acknowledged" | "failed";
  sentAt: string | null;
  acknowledgedAt: string | null;
  sentBy: string | null;
  notes: string | null;
  cadenceConfig: CadenceConfig | null;
  createdAt: string;
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  loadNumber: string | null;
  clientName: string | null;
}

interface BrokerFollowUpReminder {
  id: number;
  followUpId: number;
  sequenceNumber: number;
  reminderType: string;
  intervalDays: number | null;
  scheduledSendAt: string;
  actualSendAt: string | null;
  status: "scheduled" | "sent" | "skipped" | "paused" | "canceled";
  skipReason: string | null;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Label/color helpers ──────────────────────────────────────────────────────

function reminderTypeLabel(type: string): string {
  if (type === "immediate")  return "Immediate (Funding)";
  if (type === "due_date")   return "Due Date";
  const od = type.match(/^(\d+)d_overdue$/);
  if (od) return `${od[1]} Days Overdue`;
  const wk = type.match(/^weekly_(\d+)$/);
  if (wk) return `Weekly #${wk[1]}`;
  return type;
}

const REMINDER_STATUS_COLOR: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-800",
  sent:      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-800",
  skipped:   "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-800",
  paused:    "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
  canceled:  "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-800",
};

const BFU_STATUS_COLOR: Record<string, string> = {
  pending:      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400",
  sent:         "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400",
  acknowledged: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400",
  failed:       "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400",
};

function getPriorityColor(priority: string) {
  switch (priority) {
    case "high":   return "bg-red-100 text-red-800 border-red-200";
    case "medium": return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "low":    return "bg-green-100 text-green-800 border-green-200";
    default:       return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "completed":   return "bg-green-100 text-green-800 border-green-200";
    case "in-progress": return "bg-blue-100 text-blue-800 border-blue-200";
    default:            return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":   return <CheckCircle className="h-4 w-4" />;
    case "in-progress": return <Clock className="h-4 w-4" />;
    default:            return <AlertCircle className="h-4 w-4" />;
  }
}

// ─── Reminder timeline component ──────────────────────────────────────────────

function ReminderTimeline({
  bfuId,
  cadenceConfig,
  onCadenceChange,
}: {
  bfuId: number;
  cadenceConfig: CadenceConfig | null;
  onCadenceChange: (cfg: CadenceConfig) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editingCadence, setEditingCadence] = useState(false);
  const [localCadence, setLocalCadence] = useState<CadenceConfig>(
    cadenceConfig ?? {
      sendImmediately: true,
      sendOnDueDate: true,
      overdueIntervals: [3, 7],
      weeklyCount: 4,
      paused: false,
    },
  );
  const [overdueInput, setOverdueInput] = useState(
    (cadenceConfig?.overdueIntervals ?? [3, 7]).join(", "),
  );

  const { data: reminders = [], isLoading } = useQuery<BrokerFollowUpReminder[]>({
    queryKey: ["/api/broker-follow-ups", bfuId, "reminders"],
    queryFn: () => fetch(`/api/broker-follow-ups/${bfuId}/reminders`, { credentials: "include" }).then(r => r.json()),
  });

  const updateReminder = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/broker-follow-up-reminders/${id}`, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/broker-follow-ups", bfuId, "reminders"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to update reminder", variant: "destructive" }),
  });

  const updateCadenceMut = useMutation({
    mutationFn: (cfg: CadenceConfig) =>
      apiRequest("PATCH", `/api/broker-follow-ups/${bfuId}`, { cadenceConfig: cfg }),
    onSuccess: (_, cfg) => {
      qc.invalidateQueries({ queryKey: ["/api/broker-follow-ups"] });
      onCadenceChange(cfg);
      setEditingCadence(false);
      toast({ title: "Cadence saved" });
    },
    onError: () => toast({ title: "Error", description: "Failed to save cadence", variant: "destructive" }),
  });

  function handleReminderAction(reminder: BrokerFollowUpReminder, action: "skip" | "cancel" | "restore") {
    const statusMap = { skip: "skipped", cancel: "canceled", restore: "scheduled" } as const;
    updateReminder.mutate({ id: reminder.id, updates: { status: statusMap[action] } });
  }

  function saveCadence() {
    const intervals = overdueInput
      .split(/[\s,]+/)
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n > 0)
      .sort((a, b) => a - b);
    const cfg = { ...localCadence, overdueIntervals: intervals };
    setLocalCadence(cfg);
    updateCadenceMut.mutate(cfg);
  }

  const isPaused = cadenceConfig?.paused ?? false;

  function togglePause() {
    const cfg: CadenceConfig = { ...(cadenceConfig ?? localCadence), paused: !isPaused };
    updateCadenceMut.mutate(cfg);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-[12px] text-slate-400">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading reminder schedule…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Reminder Cadence
          <span className="ml-2 text-[10px] font-normal normal-case text-slate-400">
            {reminders.length} step{reminders.length !== 1 ? "s" : ""}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className={cn(
              "h-6 px-2 text-[10.5px] gap-1",
              isPaused
                ? "border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400"
                : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400",
            )}
            onClick={togglePause}
            disabled={updateCadenceMut.isPending}
          >
            {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {isPaused ? "Resume" : "Pause All"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10.5px] gap-1"
            onClick={() => setEditingCadence(v => !v)}
          >
            <Settings2 className="h-3 w-3" />
            Edit Cadence
          </Button>
        </div>
      </div>

      {/* Cadence editor */}
      {editingCadence && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/40 p-3 space-y-3">
          <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Cadence Settings</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <div className="flex items-center gap-2">
              <Switch
                id={`si-${bfuId}`}
                checked={localCadence.sendImmediately}
                onCheckedChange={v => setLocalCadence(c => ({ ...c, sendImmediately: v }))}
              />
              <Label htmlFor={`si-${bfuId}`} className="text-[12px] cursor-pointer">Send Immediately</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={`sd-${bfuId}`}
                checked={localCadence.sendOnDueDate}
                onCheckedChange={v => setLocalCadence(c => ({ ...c, sendOnDueDate: v }))}
              />
              <Label htmlFor={`sd-${bfuId}`} className="text-[12px] cursor-pointer">Send on Due Date</Label>
            </div>
            <div className="col-span-2">
              <Label className="text-[11px] text-slate-500 mb-1 block">Overdue Intervals (days, comma-separated)</Label>
              <Input
                value={overdueInput}
                onChange={e => setOverdueInput(e.target.value)}
                placeholder="3, 7, 14"
                className="h-7 text-[12px]"
              />
            </div>
            <div>
              <Label className="text-[11px] text-slate-500 mb-1 block">Weekly Reminders (count)</Label>
              <Input
                type="number"
                min={0}
                max={12}
                value={localCadence.weeklyCount}
                onChange={e => setLocalCadence(c => ({ ...c, weeklyCount: parseInt(e.target.value) || 0 }))}
                className="h-7 text-[12px] w-20"
              />
            </div>
          </div>
          <p className="text-[10.5px] text-amber-600 dark:text-amber-400">
            Note: editing cadence only affects future unsent reminders. Already-sent reminders are unchanged.
          </p>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="h-7 px-3 text-[11px]"
              onClick={saveCadence}
              disabled={updateCadenceMut.isPending}
            >
              {updateCadenceMut.isPending ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : null}
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-3 text-[11px]" onClick={() => setEditingCadence(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {reminders.length === 0 ? (
        <p className="text-[12px] text-slate-400 italic">No reminders scheduled.</p>
      ) : (
        <div className="relative space-y-0">
          {/* Vertical connector line */}
          <div className="absolute left-[15px] top-5 bottom-5 w-px bg-slate-200 dark:bg-slate-700" />
          {reminders.map((r, idx) => {
            const isLast  = idx === reminders.length - 1;
            const canSkip = r.status === "scheduled" || r.status === "paused";
            const canCancel = r.status === "scheduled" || r.status === "paused" || r.status === "skipped";
            const canRestore = r.status === "canceled" || r.status === "skipped";
            const overdue = r.status === "scheduled" && isPast(new Date(r.scheduledSendAt));

            return (
              <div
                key={r.id}
                className={cn(
                  "relative flex gap-3 py-2",
                  r.status === "canceled" && "opacity-50",
                )}
              >
                {/* Step dot */}
                <div className={cn(
                  "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold",
                  r.status === "sent"     ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" :
                  r.status === "canceled" ? "border-red-300 bg-red-50 text-red-400 dark:bg-red-950/20" :
                  r.status === "skipped"  ? "border-amber-300 bg-amber-50 text-amber-600 dark:bg-amber-950/20" :
                  overdue                 ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 animate-pulse" :
                  "border-slate-300 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-800"
                )}>
                  {r.sequenceNumber}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-slate-800 dark:text-white">
                      {reminderTypeLabel(r.reminderType)}
                    </span>
                    <span className={cn(
                      "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold capitalize",
                      REMINDER_STATUS_COLOR[r.status],
                    )}>
                      {r.status === "sent" && <CheckCheck className="mr-0.5 h-2.5 w-2.5" />}
                      {r.status === "canceled" && <Ban className="mr-0.5 h-2.5 w-2.5" />}
                      {r.status === "skipped" && <SkipForward className="mr-0.5 h-2.5 w-2.5" />}
                      {r.status === "paused" && <Pause className="mr-0.5 h-2.5 w-2.5" />}
                      {r.status}
                    </span>
                    {overdue && (
                      <span className="text-[10px] font-semibold text-orange-600 dark:text-orange-400">
                        ⚠ {formatDistanceToNow(new Date(r.scheduledSendAt))} overdue
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Scheduled: {format(new Date(r.scheduledSendAt), "MMM d, yyyy HH:mm")}
                    </span>
                    {r.actualSendAt && (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <Send className="h-3 w-3" />
                        Sent: {format(new Date(r.actualSendAt), "MMM d, yyyy HH:mm")}
                      </span>
                    )}
                  </div>
                  {r.skipReason && (
                    <p className="mt-0.5 text-[11px] italic text-slate-400">{r.skipReason}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-start gap-1 pt-0.5 shrink-0">
                  {canRestore && (
                    <button
                      type="button"
                      onClick={() => handleReminderAction(r, "restore")}
                      disabled={updateReminder.isPending}
                      className="flex items-center gap-0.5 rounded-md bg-slate-100 px-2 py-1 text-[10.5px] font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 disabled:opacity-50"
                      title="Restore to scheduled"
                    >
                      <RotateCcw className="h-3 w-3" /> Restore
                    </button>
                  )}
                  {canSkip && (
                    <button
                      type="button"
                      onClick={() => handleReminderAction(r, "skip")}
                      disabled={updateReminder.isPending}
                      className="flex items-center gap-0.5 rounded-md bg-amber-50 px-2 py-1 text-[10.5px] font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-950/20 dark:text-amber-400 disabled:opacity-50"
                      title="Skip this reminder"
                    >
                      <SkipForward className="h-3 w-3" /> Skip
                    </button>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      onClick={() => handleReminderAction(r, "cancel")}
                      disabled={updateReminder.isPending}
                      className="flex items-center gap-0.5 rounded-md bg-red-50 px-2 py-1 text-[10.5px] font-medium text-red-600 hover:bg-red-100 dark:bg-red-950/20 dark:text-red-400 disabled:opacity-50"
                      title="Cancel this reminder"
                    >
                      <Ban className="h-3 w-3" /> Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Inline note editor ───────────────────────────────────────────────────────

function NoteEditor({
  bfu, onSave, saving,
}: { bfu: BrokerFollowUp; onSave: (notes: string) => void; saving: boolean }) {
  const [notes, setNotes] = useState(bfu.notes ?? "");
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Agent Notes</p>
      <Textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={3}
        placeholder="Add notes about this follow-up…"
        className="text-[12px] resize-none"
      />
      <Button
        size="sm"
        variant="outline"
        className="mt-1.5 h-7 px-3 text-[11px]"
        disabled={saving || notes === (bfu.notes ?? "")}
        onClick={() => onSave(notes)}
      >
        {saving ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : null}
        Save Notes
      </Button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FollowUpPage() {
  const [searchTerm, setSearchTerm]     = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [isAddingFollowUp, setIsAddingFollowUp] = useState(false);
  const [bfuSearch, setBfuSearch]         = useState("");
  const [bfuStatusFilter, setBfuStatusFilter] = useState("all");
  const [expandedBfu, setExpandedBfu]     = useState<number | null>(null);
  const [localCadences, setLocalCadences] = useState<Record<number, CadenceConfig>>({});
  const { toast }  = useToast();
  const qc = useQueryClient();

  const form = useForm<z.infer<typeof followUpSchema>>({
    resolver: zodResolver(followUpSchema),
    defaultValues: { status: "pending", priority: "medium" },
  });

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: followUps = [], isLoading }  = useQuery<FollowUp[]>({ queryKey: ["/api/follow-ups"] });
  const { data: clients = [] }               = useQuery({ queryKey: ["/api/clients"] });
  const { data: brokerFollowUps = [], isLoading: bfuLoading } = useQuery<BrokerFollowUp[]>({
    queryKey: ["/api/broker-follow-ups"],
  });

  // ── Manual follow-up mutations ────────────────────────────────────────────────
  const addFollowUpMutation = useMutation({
    mutationFn: (data: z.infer<typeof followUpSchema>) => apiRequest("POST", "/api/follow-ups", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/follow-ups"] });
      form.reset();
      setIsAddingFollowUp(false);
      toast({ title: "Success", description: "Follow-up task created successfully" });
    },
    onError: () => toast({ title: "Error", description: "Failed to create follow-up task", variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/follow-ups/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/follow-ups"] });
      toast({ title: "Success", description: "Follow-up status updated" });
    },
  });

  // ── Broker follow-up mutations ────────────────────────────────────────────────
  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/broker-follow-ups/${id}`, { status: "acknowledged" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/broker-follow-ups"] });
      toast({ title: "Acknowledged", description: "Broker follow-up marked as acknowledged" });
    },
  });

  const saveNotesMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      apiRequest("PATCH", `/api/broker-follow-ups/${id}`, { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/broker-follow-ups"] });
      toast({ title: "Saved", description: "Notes saved" });
    },
  });

  const handleCadenceChange = useCallback((bfuId: number, cfg: CadenceConfig) => {
    setLocalCadences(prev => ({ ...prev, [bfuId]: cfg }));
  }, []);

  const onSubmit = (data: z.infer<typeof followUpSchema>) => addFollowUpMutation.mutate(data);

  // ── Filtered lists ────────────────────────────────────────────────────────────
  const filteredFollowUps = (followUps as FollowUp[]).filter(f => {
    const matchesSearch =
      f.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.client?.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch &&
      (statusFilter === "all"   || f.status === statusFilter) &&
      (priorityFilter === "all" || f.priority === priorityFilter);
  });

  const filteredBfu = (brokerFollowUps as BrokerFollowUp[]).filter(b => {
    const q = bfuSearch.toLowerCase();
    const matchesSearch = !q ||
      (b.invoiceNumber ?? "").toLowerCase().includes(q) ||
      (b.clientName ?? "").toLowerCase().includes(q) ||
      (b.loadNumber ?? "").toLowerCase().includes(q);
    return matchesSearch && (bfuStatusFilter === "all" || b.status === bfuStatusFilter);
  });

  const pendingBfuCount = (brokerFollowUps as BrokerFollowUp[]).filter(
    b => b.status !== "acknowledged",
  ).length;

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Follow Ups" subtitle="Manage client follow-ups, pending tasks, and broker automations" />

        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">

            {/* Header */}
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                  <Clock className="h-8 w-8 text-blue-600" />
                  Follow Up Tasks
                </h1>
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  Manage client follow-ups, tasks, and broker payment reminder cadences
                </p>
              </div>
              <Dialog open={isAddingFollowUp} onOpenChange={setIsAddingFollowUp}>
                <DialogTrigger asChild>
                  <Button className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Add Follow Up
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Create Follow Up Task</DialogTitle>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <FormField control={form.control} name="clientId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Client</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {(clients as any[]).map((c: any) => (
                                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="title" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl><Input placeholder="Follow-up task title" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="description" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl><Textarea placeholder="Additional details…" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="priority" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Priority</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="low">Low</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="dueDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Due Date</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="flex justify-end gap-2 pt-4">
                        <Button type="button" variant="outline" onClick={() => setIsAddingFollowUp(false)}>Cancel</Button>
                        <Button type="submit" disabled={addFollowUpMutation.isPending}>Create Follow Up</Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="manual">
              <TabsList className="mb-4">
                <TabsTrigger value="manual" className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Manual Tasks
                  {filteredFollowUps.length > 0 && (
                    <span className="ml-1 rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold">
                      {filteredFollowUps.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="broker" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Broker Automations
                  {pendingBfuCount > 0 && (
                    <span className="ml-1 rounded-full bg-orange-500 text-white px-1.5 py-0.5 text-[10px] font-bold">
                      {pendingBfuCount}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── Manual follow-ups ─────────────────────────────────────────── */}
              <TabsContent value="manual" className="space-y-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap gap-4 items-center">
                      <div className="flex items-center gap-2 flex-1 min-w-64">
                        <Search className="h-4 w-4 text-gray-400" />
                        <Input
                          placeholder="Search follow-ups..."
                          value={searchTerm}
                          onChange={e => setSearchTerm(e.target.value)}
                        />
                      </div>
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-48"><SelectValue placeholder="Filter by status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="in-progress">In Progress</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                        <SelectTrigger className="w-48"><SelectValue placeholder="Filter by priority" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Priority</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-4">
                  {isLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
                      <p className="text-gray-600 mt-2">Loading follow-ups...</p>
                    </div>
                  ) : filteredFollowUps.length === 0 ? (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No follow-ups found</h3>
                        <p className="text-gray-600 dark:text-gray-400">
                          {searchTerm || statusFilter !== "all" || priorityFilter !== "all"
                            ? "Try adjusting your filters"
                            : "Create your first follow-up task to get started"}
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    filteredFollowUps.map(followUp => (
                      <Card key={followUp.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{followUp.title}</h3>
                                <Badge className={getPriorityColor(followUp.priority)}>{followUp.priority}</Badge>
                                <Badge className={getStatusColor(followUp.status)}>
                                  <span className="flex items-center gap-1">
                                    {getStatusIcon(followUp.status)}
                                    {followUp.status.replace("-", " ")}
                                  </span>
                                </Badge>
                              </div>
                              {followUp.description && (
                                <p className="text-gray-600 dark:text-gray-400 mb-3">{followUp.description}</p>
                              )}
                              <div className="flex items-center gap-4 text-sm text-gray-500">
                                <div className="flex items-center gap-1">
                                  <User className="h-4 w-4" />{followUp.client?.name}
                                </div>
                                <div className="flex items-center gap-1">
                                  <Calendar className="h-4 w-4" />
                                  Due: {format(new Date(followUp.dueDate), "MMM dd, yyyy")}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                              {followUp.status !== "completed" && (
                                <>
                                  {followUp.status === "pending" && (
                                    <Button size="sm" variant="outline"
                                      onClick={() => updateStatusMutation.mutate({ id: followUp.id, status: "in-progress" })}
                                    >Start</Button>
                                  )}
                                  <Button size="sm"
                                    onClick={() => updateStatusMutation.mutate({ id: followUp.id, status: "completed" })}
                                  >Complete</Button>
                                </>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* ── Broker automations ────────────────────────────────────────── */}
              <TabsContent value="broker" className="space-y-4">
                <div className="flex items-start gap-3 rounded-xl border border-orange-200/70 bg-orange-50/60 px-4 py-3 dark:border-orange-900/40 dark:bg-orange-950/10">
                  <Zap className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" />
                  <p className="text-[12.5px] text-orange-800 dark:text-orange-300">
                    <span className="font-semibold">Automated follow-ups</span> are triggered when an invoice is funded.
                    Each follow-up runs a configurable reminder cadence — immediate, due date, overdue intervals, and weekly reminders.
                  </p>
                </div>

                <Card>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap gap-4 items-center">
                      <div className="flex items-center gap-2 flex-1 min-w-64">
                        <Search className="h-4 w-4 text-gray-400" />
                        <Input
                          placeholder="Search by invoice, carrier, load…"
                          value={bfuSearch}
                          onChange={e => setBfuSearch(e.target.value)}
                        />
                      </div>
                      <Select value={bfuStatusFilter} onValueChange={setBfuStatusFilter}>
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="sent">Sent</SelectItem>
                          <SelectItem value="acknowledged">Acknowledged</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {bfuLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto" />
                  </div>
                ) : filteredBfu.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <Mail className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No broker follow-ups yet</h3>
                      <p className="text-gray-600 dark:text-gray-400">
                        {bfuSearch || bfuStatusFilter !== "all"
                          ? "Try adjusting your filters"
                          : "Broker follow-ups are created automatically when invoices are funded."}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {filteredBfu.map(bfu => {
                      const isExpanded = expandedBfu === bfu.id;
                      const cadence = localCadences[bfu.id] ?? bfu.cadenceConfig;
                      return (
                        <Card key={bfu.id} className={cn(
                          "overflow-hidden transition-shadow",
                          isExpanded && "ring-1 ring-orange-200 dark:ring-orange-800",
                        )}>
                          {/* Row header */}
                          <div
                            className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-900/30"
                            onClick={() => setExpandedBfu(isExpanded ? null : bfu.id)}
                          >
                            {/* Invoice # */}
                            <div className="min-w-[110px]">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Invoice</p>
                              <p className="text-[13px] font-bold text-slate-900 dark:text-white">
                                {bfu.invoiceNumber ?? `#${bfu.invoiceId}`}
                              </p>
                            </div>
                            {/* Carrier */}
                            <div className="min-w-[130px]">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Carrier</p>
                              <p className="text-[13px] text-slate-700 dark:text-slate-300 truncate">
                                {bfu.clientName ?? "—"}
                              </p>
                            </div>
                            {/* Amount */}
                            <div className="min-w-[90px]">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Amount</p>
                              <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">
                                {bfu.invoiceAmount
                                  ? `$${Number(bfu.invoiceAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                                  : "—"}
                              </p>
                            </div>
                            {/* Trigger */}
                            <div>
                              <span className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold border",
                                bfu.triggerType === "auto"
                                  ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400"
                                  : "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/20 dark:text-violet-400",
                              )}>
                                {bfu.triggerType === "auto" ? <Zap className="h-3 w-3" /> : <User className="h-3 w-3" />}
                                {bfu.triggerType}
                              </span>
                            </div>
                            {/* Status */}
                            <div>
                              <span className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold border capitalize",
                                BFU_STATUS_COLOR[bfu.status] ?? "bg-gray-50 text-gray-600 border-gray-200",
                              )}>
                                {bfu.status === "acknowledged" && <CheckCheck className="h-3 w-3" />}
                                {bfu.status === "sent" && <Mail className="h-3 w-3" />}
                                {bfu.status}
                              </span>
                            </div>
                            {/* Cadence paused badge */}
                            {cadence?.paused && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[10px] font-bold">
                                <Pause className="h-2.5 w-2.5" /> Paused
                              </span>
                            )}
                            {/* Created */}
                            <div className="ml-auto text-[11px] text-slate-400 whitespace-nowrap">
                              {bfu.createdAt ? format(new Date(bfu.createdAt), "MMM d, yyyy") : "—"}
                            </div>
                            {/* Chevron */}
                            <div className="ml-2 text-slate-400">
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                          </div>

                          {/* Expanded detail */}
                          {isExpanded && (
                            <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 px-5 py-4">
                              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

                                {/* Left: reminder timeline */}
                                <ReminderTimeline
                                  bfuId={bfu.id}
                                  cadenceConfig={cadence}
                                  onCadenceChange={cfg => handleCadenceChange(bfu.id, cfg)}
                                />

                                {/* Right: email preview + notes + actions */}
                                <div className="space-y-4">
                                  <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Initial Email Subject</p>
                                    <p className="text-[13px] text-slate-700 dark:text-slate-300">{bfu.subject}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Email Body Preview</p>
                                    <pre className="text-[11.5px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap font-sans bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700 max-h-48 overflow-auto">
                                      {bfu.body}
                                    </pre>
                                  </div>
                                  <NoteEditor
                                    bfu={bfu}
                                    onSave={notes => saveNotesMutation.mutate({ id: bfu.id, notes })}
                                    saving={saveNotesMutation.isPending}
                                  />
                                  {/* Timestamps */}
                                  <div className="grid grid-cols-2 gap-2 text-[12px]">
                                    {bfu.sentAt && (
                                      <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sent At</p>
                                        <p className="text-slate-600 dark:text-slate-300">{format(new Date(bfu.sentAt), "MMM d, yyyy HH:mm")}</p>
                                      </div>
                                    )}
                                    {bfu.acknowledgedAt && (
                                      <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Acknowledged</p>
                                        <p className="text-slate-600 dark:text-slate-300">{format(new Date(bfu.acknowledgedAt), "MMM d, yyyy HH:mm")}</p>
                                      </div>
                                    )}
                                  </div>
                                  {/* Acknowledge button */}
                                  {bfu.status !== "acknowledged" && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 px-3 text-[12px] w-full"
                                      disabled={acknowledgeMutation.isPending}
                                      onClick={e => { e.stopPropagation(); acknowledgeMutation.mutate(bfu.id); }}
                                    >
                                      <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                                      Acknowledge Follow-Up
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
}
