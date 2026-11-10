import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { MouseEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NeuTextarea as Textarea } from "@/styles/neu";
import { PageInsights } from "@/components/PageInsights";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  RecoveryPageFrame as PageShell, RecoveryBadge as Badge, RecoveryButton as Button,
  RecoveryCard as Card, RecoveryCardContent as CardContent, RecoveryInput as Input, RecoverySelectContent as SelectContent,
  RecoverySelectTrigger as SelectTrigger,
  RecoveryTable as NeuTable, RecoveryTableBody as NeuTableBody,
  RecoveryTableCell as NeuTableCell, RecoveryTableHead as NeuTableHead,
  RecoveryTableHeader as NeuTableHeader, RecoveryTableRow as NeuTableRow,
  RecoveryTabs as Tabs, RecoveryTabsContent as TabsContent, RecoveryTabList as TabsList,
  RecoveryTab as TabsTrigger, RecoveryDialogContent as DialogContent, useRecoveryToast,
} from "@/components/recovery/recovery-controls";
import { Select, SelectItem, SelectValue } from "@/components/ui/select";
import "@/components/recovery/recovery-neu.css";
import {
  Clock, Plus, Search, Calendar, AlertCircle, CheckCircle, User, FileText,
  Mail, Zap, CheckCheck, RefreshCw, ChevronDown, ChevronUp, Ban, SkipForward,
  RotateCcw, Settings2, Pause, Play, Send, LayoutTemplate, Star, Trash2,
  Eye, Pencil, Copy, ShieldOff,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import ConfirmationFollowUpQueue from "@/components/broker-confirmation/follow-up-queue";
import CollectionsAutomation from "@/components/broker-confirmation/collections-automation";
import EntityNotes from "@/components/shared/EntityNotes";
import { ServerArrayPagination, SERVER_ARRAY_PAGE_SIZE, useServerArrayPage } from "@/hooks/use-server-array-page";

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

interface BrokerFollowUpTemplate {
  id: number;
  name: string;
  triggerType: "immediate" | "due_date" | "overdue" | "escalation";
  subject: string;
  body: string;
  isDefault: boolean;
  createdAt: string;
  createdBy: string | null;
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
  providerMessageId: string | null;
  deliveryStatus: string | null;
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Template constants ───────────────────────────────────────────────────────

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  immediate:  "Initial Funding Notice",
  due_date:   "Payment Due Reminder",
  overdue:    "Overdue Reminder",
  escalation: "Escalation Notice",
};

const TRIGGER_TYPE_COLORS: Record<string, string> = {
  immediate:  "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-800",
  due_date:   "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/20 dark:text-violet-400 dark:border-violet-800",
  overdue:    "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-800",
  escalation: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-800",
};

const PLACEHOLDERS = [
  "{{brokerName}}",
  "{{invoiceNumber}}",
  "{{loadNumber}}",
  "{{amountDue}}",
  "{{dueDate}}",
  "{{paymentInstructions}}",
  "{{contactName}}",
];

const SAMPLE_VARS: Record<string, string> = {
  "{{brokerName}}":          "Acme Brokerage LLC",
  "{{invoiceNumber}}":       "INV-2024-001",
  "{{loadNumber}}":          "LD-5892",
  "{{amountDue}}":           "$4,250.00",
  "{{dueDate}}":             "Jun 15, 2024",
  "{{paymentInstructions}}": "ACH to: Trucking Pros Financial — Routing: 021000021 · Account: 1234567890",
  "{{contactName}}":         "Collections Team",
};

function applyPreview(text: string): string {
  return Object.entries(SAMPLE_VARS).reduce(
    (t, [k, v]) => t.replaceAll(k, v),
    text,
  );
}

const templateSchema = z.object({
  name:        z.string().min(1, "Name is required"),
  triggerType: z.enum(["immediate", "due_date", "overdue", "escalation"]),
  subject:     z.string().min(1, "Subject is required"),
  body:        z.string().min(1, "Body is required"),
  isDefault:   z.boolean().default(false),
});

// ─── Template editor dialog ───────────────────────────────────────────────────

function TemplateDialog({
  open, onOpenChange, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: BrokerFollowUpTemplate | null;
  onSaved: () => void;
}) {
  const { toast } = useRecoveryToast();
  const [preview, setPreview] = useState(false);
  const isEdit = !!initial;

  const form = useForm<z.infer<typeof templateSchema>>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name:        initial?.name        ?? "",
      triggerType: initial?.triggerType ?? "immediate",
      subject:     initial?.subject     ?? "",
      body:        initial?.body        ?? "",
      isDefault:   initial?.isDefault   ?? false,
    },
  });

  // Reset form when dialog opens/closes or initial changes
  const resetForm = () => {
    form.reset({
      name:        initial?.name        ?? "",
      triggerType: initial?.triggerType ?? "immediate",
      subject:     initial?.subject     ?? "",
      body:        initial?.body        ?? "",
      isDefault:   initial?.isDefault   ?? false,
    });
    setPreview(false);
  };

  const saveMut = useMutation({
    mutationFn: (data: z.infer<typeof templateSchema>) => isEdit
      ? apiRequest("PATCH", `/api/broker-follow-up-templates/${initial!.id}`, data)
      : apiRequest("POST",  "/api/broker-follow-up-templates", data),
    onSuccess: () => {
      toast({ title: isEdit ? "Template updated" : "Template created" });
      onSaved();
      onOpenChange(false);
    },
    onError: () => toast({ title: "Error", description: "Failed to save template", variant: "destructive" }),
  });

  const body    = form.watch("body");
  const subject = form.watch("subject");

  function insertPlaceholder(ph: string) {
    const ta = document.getElementById("tpl-body") as HTMLTextAreaElement | null;
    if (!ta) { form.setValue("body", body + ph); return; }
    const start = ta.selectionStart ?? body.length;
    const end   = ta.selectionEnd   ?? body.length;
    const next  = body.slice(0, start) + ph + body.slice(end);
    form.setValue("body", next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + ph.length, start + ph.length);
    });
  }

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="recovery-neu-dialog sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Template" : "New Template"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(d => saveMut.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Template Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Overdue – Firm Tone" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="triggerType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Trigger Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="immediate">Immediate (Funding)</SelectItem>
                      <SelectItem value="due_date">Payment Due</SelectItem>
                      <SelectItem value="overdue">Overdue Reminder</SelectItem>
                      <SelectItem value="escalation">Escalation Notice</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="subject" render={({ field }) => (
              <FormItem>
                <FormLabel>Email Subject</FormLabel>
                <FormControl><Input placeholder="e.g. Payment Due — Invoice {{invoiceNumber}}" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Placeholder chips */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                Click to insert placeholder
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map(ph => (
                  <Button
                    key={ph}
                    type="button"
                    onClick={() => insertPlaceholder(ph)}
                    className="!min-h-8 rounded-full px-3 py-1 text-[11px] font-mono text-[#45605c]"
                  >
                    {ph}
                  </Button>
                ))}
              </div>
            </div>

            <FormField control={form.control} name="body" render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between mb-1">
                  <FormLabel>Email Body</FormLabel>
                  <Button
                    type="button"
                    onClick={() => setPreview(v => !v)}
                    className="!min-h-8 flex items-center gap-1 px-3 py-1 text-[11px]"
                  >
                    <Eye className="h-3 w-3" />
                    {preview ? "Edit" : "Preview"}
                  </Button>
                </div>
                {preview ? (
                  <div className="rounded-2xl bg-[#e0e0e0] p-3 shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8] space-y-2">
                    <p className="text-[11px] font-semibold text-slate-500">Subject:</p>
                    <p className="text-[13px] text-slate-800 dark:text-slate-200">{applyPreview(subject)}</p>
                    <hr className="border-slate-200 dark:border-slate-700" />
                    <pre className="text-[12px] whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300 max-h-52 overflow-auto">
                      {applyPreview(body)}
                    </pre>
                  </div>
                ) : (
                  <FormControl>
                    <Textarea
                      id="tpl-body"
                      rows={10}
                      placeholder="Email body…"
                      className="font-mono text-[12px] resize-y"
                      {...field}
                    />
                  </FormControl>
                )}
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="isDefault" render={({ field }) => (
              <FormItem className="flex items-center gap-3 rounded-2xl bg-[#e0e0e0] px-3 py-2.5 shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8]">
                <Switch checked={field.value} onCheckedChange={field.onChange} id="tpl-default" />
                <div>
                  <Label htmlFor="tpl-default" className="text-sm font-medium cursor-pointer">
                    Set as default for this trigger type
                  </Label>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Only one template per trigger type can be the default used by the automation engine.
                  </p>
                </div>
              </FormItem>
            )} />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={saveMut.isPending}>
                {saveMut.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                {isEdit ? "Save Changes" : "Create Template"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
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
  scheduled: "ff-badge-submitted",
  sent:      "ff-badge-funded",
  skipped:   "ff-badge-pending",
  paused:    "ff-badge-draft",
  canceled:  "ff-badge-rejected",
};

const BFU_STATUS_COLOR: Record<string, string> = {
  pending:      "ff-badge-pending",
  sent:         "ff-badge-submitted",
  acknowledged: "ff-badge-funded",
  failed:       "ff-badge-rejected",
};

function getPriorityColor(priority: string) {
  switch (priority) {
    case "high":   return "ff-badge-rejected";
    case "medium": return "ff-badge-pending";
    case "low":    return "ff-badge-funded";
    default:       return "ff-badge-draft";
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "completed":   return "ff-badge-funded";
    case "in-progress": return "ff-badge-submitted";
    default:            return "ff-badge-pending";
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
  const { toast } = useRecoveryToast();
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
  const [editingReminder, setEditingReminder] = useState<BrokerFollowUpReminder | null>(null);
  const [reminderDraft, setReminderDraft] = useState({ scheduledSendAt: "", subject: "", body: "" });

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
  const editReminderMut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/broker-follow-ups/${bfuId}/reminders/${editingReminder!.id}`, {
      scheduledSendAt: new Date(reminderDraft.scheduledSendAt).toISOString(),
      emailSubject: reminderDraft.subject, emailBody: reminderDraft.body,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/broker-follow-ups", bfuId, "reminders"] });
      setEditingReminder(null); toast({ title: "Reminder updated" });
    },
    onError: () => toast({ title: "Unable to edit reminder", description: "Only scheduled reminders may be edited.", variant: "destructive" }),
  });
  function openReminderEditor(reminder: BrokerFollowUpReminder) {
    setReminderDraft({
      scheduledSendAt: format(new Date(reminder.scheduledSendAt), "yyyy-MM-dd'T'HH:mm"),
      subject: reminder.subject, body: reminder.body,
    });
    setEditingReminder(reminder);
  }

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
          variant="outline"
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
        <div className="rounded-2xl bg-[#e0e0e0] p-3 shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8] space-y-3">
          <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Cadence Settings</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <div className="flex items-center gap-2">
              <Switch
                id={`si-${bfuId}`}
                checked={localCadence.sendImmediately}
                onCheckedChange={v => setLocalCadence(c => ({ ...c, sendImmediately: v }))}
                className="ff-followups-switch"
              />
              <Label htmlFor={`si-${bfuId}`} className="text-[12px] cursor-pointer">Send Immediately</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={`sd-${bfuId}`}
                checked={localCadence.sendOnDueDate}
                onCheckedChange={v => setLocalCadence(c => ({ ...c, sendOnDueDate: v }))}
                className="ff-followups-switch"
              />
              <Label htmlFor={`sd-${bfuId}`} className="text-[12px] cursor-pointer">Send on Due Date</Label>
            </div>
            <div className="col-span-2">
              <Label className="text-[11px] text-slate-500 mb-1 block">Overdue Intervals (days, comma-separated)</Label>
              <Input
                value={overdueInput}
                onChange={e => setOverdueInput(e.target.value)}
                placeholder="3, 7, 14"
                className="ff-followups-field h-7 text-[12px]"
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
                className="ff-followups-field h-7 text-[12px] w-20"
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
            <Button size="sm" variant="outline" className="h-7 px-3 text-[11px]" onClick={() => setEditingCadence(false)}>
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
          {reminders.map((r) => {
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
                <div data-ff-status-pulse className={cn(
                  "ff-followup-step relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e0e0e0] text-[10px] font-bold",
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
                    <Badge className={cn("gap-1 capitalize", REMINDER_STATUS_COLOR[r.status])}>
                      {r.status === "sent" && <CheckCheck className="mr-0.5 h-2.5 w-2.5" />}
                      {r.status === "canceled" && <Ban className="mr-0.5 h-2.5 w-2.5" />}
                      {r.status === "skipped" && <SkipForward className="mr-0.5 h-2.5 w-2.5" />}
                      {r.status === "paused" && <Pause className="mr-0.5 h-2.5 w-2.5" />}
                      {r.status}
                    </Badge>
                    {r.editedAt && <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300">Edited</span>}
                    {/* Delivery status badge */}
                    {r.status === "sent" && (() => {
                      const ds = r.deliveryStatus;
                      if (!ds || ds === "pending") return (
                        <Badge className="ff-badge-draft gap-1">Pending</Badge>
                      );
                      if (ds === "delivered") return (
                        <Badge className="ff-badge-funded gap-1">Delivered</Badge>
                      );
                      if (ds === "bounced") return (
                        <Badge className="ff-badge-rejected gap-1">Bounced</Badge>
                      );
                      if (ds === "failed") return (
                        <Badge className="ff-badge-rejected gap-1">Failed</Badge>
                      );
                      if (ds === "spam") return (
                        <Badge className="ff-badge-pending gap-1">Spam</Badge>
                      );
                      if (ds === "unsubscribed") return (
                        <Badge className="ff-badge-draft gap-1">Unsubscribed</Badge>
                      );
                      return null;
                    })()}
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
                  {r.status === "scheduled" && (
                    <Button type="button" onClick={() => openReminderEditor(r)}
                      className="!min-h-8 flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium">
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                  )}
                  {canRestore && (
                    <Button
                      type="button"
                      onClick={() => handleReminderAction(r, "restore")}
                      disabled={updateReminder.isPending}
                      className="!min-h-8 flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium"
                      title="Restore to scheduled"
                    >
                      <RotateCcw className="h-3 w-3" /> Restore
                    </Button>
                  )}
                  {canSkip && (
                    <Button
                      type="button"
                      onClick={() => handleReminderAction(r, "skip")}
                      disabled={updateReminder.isPending}
                      className="!min-h-8 flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium !text-amber-800"
                      title="Skip this reminder"
                    >
                      <SkipForward className="h-3 w-3" /> Skip
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      type="button"
                      onClick={() => handleReminderAction(r, "cancel")}
                      disabled={updateReminder.isPending}
                      className="!min-h-8 flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium !text-red-700"
                      title="Cancel this reminder"
                    >
                      <Ban className="h-3 w-3" /> Cancel
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dialog open={!!editingReminder} onOpenChange={open => !open && setEditingReminder(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Edit Scheduled Reminder</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Send date & time</Label><Input className="mt-1" type="datetime-local" value={reminderDraft.scheduledSendAt} onChange={e => setReminderDraft(d => ({ ...d, scheduledSendAt: e.target.value }))} /></div>
            <div><Label>Subject</Label><Input className="mt-1" value={reminderDraft.subject} onChange={e => setReminderDraft(d => ({ ...d, subject: e.target.value }))} /></div>
            <div><Label>Message</Label><Textarea className="mt-1 min-h-36" value={reminderDraft.body} onChange={e => setReminderDraft(d => ({ ...d, body: e.target.value }))} /></div>
            <div className="flex flex-wrap gap-1"><span className="mr-1 text-[11px] text-slate-500">Insert:</span>{["{{brokerName}}", "{{invoiceNumber}}", "{{loadNumber}}", "{{amountDue}}", "{{dueDate}}"].map(token => <Button type="button" key={token} onClick={() => setReminderDraft(d => ({ ...d, body: `${d.body}${d.body ? " " : ""}${token}` }))} className="!min-h-7 rounded-full px-2 py-0.5 text-[10px]">{token}</Button>)}</div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditingReminder(null)}>Cancel</Button><Button disabled={!reminderDraft.scheduledSendAt || !reminderDraft.subject.trim() || !reminderDraft.body.trim() || editReminderMut.isPending} onClick={() => editReminderMut.mutate()}>{editReminderMut.isPending ? "Saving…" : "Save reminder"}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FollowUpPage() {
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const requestedFollowUpId = new URLSearchParams(queryString).get("followupId");
  const pendingFocusId = useRef<number | null>(null);
  const handledFocusId = useRef<number | null>(null);
  const [searchTerm, setSearchTerm]     = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [isAddingFollowUp, setIsAddingFollowUp] = useState(false);
  const [bfuSearch, setBfuSearch]         = useState("");
  const [bfuStatusFilter, setBfuStatusFilter] = useState("all");
  const [expandedBfu, setExpandedBfu]     = useState<number | null>(null);
  const [localCadences, setLocalCadences] = useState<Record<number, CadenceConfig>>({});
  const [tplDialogOpen, setTplDialogOpen] = useState(false);
  const [editingTpl, setEditingTpl]       = useState<BrokerFollowUpTemplate | null>(null);
  const [previewTpl, setPreviewTpl]       = useState<BrokerFollowUpTemplate | null>(null);
  const { toast }  = useRecoveryToast();
  const qc = useQueryClient();

  const form = useForm<z.infer<typeof followUpSchema>>({
    resolver: zodResolver(followUpSchema),
    defaultValues: { status: "pending", priority: "medium" },
  });

  useEffect(() => {
    pendingFocusId.current = null;
    handledFocusId.current = null;
  }, [requestedFollowUpId]);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const manualParams = useMemo<Record<string, string>>(() => ({
    ...(searchTerm.trim() ? { q: searchTerm.trim() } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(priorityFilter !== "all" ? { priority: priorityFilter } : {}),
  }), [searchTerm, statusFilter, priorityFilter]);
  const {
    items: followUps,
    total: followUpsTotal,
    page: followUpsPage,
    pageCount: followUpsPageCount,
    isLoading,
    isFetching: followUpsFetching,
    isError: followUpsError,
    error: followUpsErrorValue,
    refetch: refetchFollowUps,
    setPage: setFollowUpsPage,
  } = useServerArrayPage<FollowUp>("/api/follow-ups", {
    params: manualParams,
    resetKey: JSON.stringify(manualParams),
  });
  const focusPageQuery = useQuery<number | null>({
    queryKey: ["/api/follow-ups", "focus-page", requestedFollowUpId],
    enabled: !!requestedFollowUpId && /^\d+$/.test(requestedFollowUpId) && !followUps.some(item => item.id === Number(requestedFollowUpId)),
    queryFn: async () => {
      const fetchPage = async (page: number) => {
        const url = new URL("/api/follow-ups", window.location.origin);
        url.searchParams.set("page", String(page));
        url.searchParams.set("limit", String(SERVER_ARRAY_PAGE_SIZE));
        const response = await fetch(url.toString(), { credentials: "include" });
        if (!response.ok) throw new Error(`Could not find requested follow-up (HTTP ${response.status}).`);
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error("The follow-up endpoint returned an unexpected response.");
        const totalHeader = response.headers.get("X-Total-Count");
        const totalValue = totalHeader === null ? Number.NaN : Number(totalHeader);
        return {
          rows: rows as FollowUp[],
          total: Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : rows.length,
        };
      };
      const first = await fetchPage(1);
      if (first.rows.some(item => item.id === Number(requestedFollowUpId))) return 1;
      const pages = Math.ceil(first.total / SERVER_ARRAY_PAGE_SIZE);
      for (let page = 2; page <= pages; page += 1) {
        const result = await fetchPage(page);
        if (result.rows.some(item => item.id === Number(requestedFollowUpId))) return page;
      }
      return null;
    },
  });
  const { data: clients = [] }               = useQuery({ queryKey: ["/api/follow-up-clients"] });
  const { data: brokerFollowUps = [], isLoading: bfuLoading } = useQuery<BrokerFollowUp[]>({
    queryKey: ["/api/broker-follow-ups"],
  });
  const { data: templates = [], isLoading: tplLoading } = useQuery<BrokerFollowUpTemplate[]>({
    queryKey: ["/api/broker-follow-up-templates"],
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

  const suppressMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/broker-follow-ups/${id}/suppress`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/broker-follow-ups"] });
      toast({ title: "Suppressed", description: "All pending reminders cancelled." });
    },
    onError: () => toast({ title: "Error", description: "Failed to suppress cadence", variant: "destructive" }),
  });

  // ── Template mutations ────────────────────────────────────────────────────────
  const deleteTplMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/broker-follow-up-templates/${id}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/broker-follow-up-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete template", variant: "destructive" }),
  });

  const setDefaultTplMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/broker-follow-up-templates/${id}/set-default`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/broker-follow-up-templates"] });
      toast({ title: "Default set", description: "Automation engine will use this template." });
    },
    onError: () => toast({ title: "Error", description: "Failed to set default", variant: "destructive" }),
  });

  const handleCadenceChange = useCallback((bfuId: number, cfg: CadenceConfig) => {
    setLocalCadences(prev => ({ ...prev, [bfuId]: cfg }));
  }, []);

  const onSubmit = (data: z.infer<typeof followUpSchema>) => addFollowUpMutation.mutate(data);

  // ── Filtered lists ────────────────────────────────────────────────────────────
  const filteredFollowUps = followUps;

  useEffect(() => {
    if (!requestedFollowUpId || isLoading || !/^\d+$/.test(requestedFollowUpId)) return;
    const id = Number(requestedFollowUpId);
    if (handledFocusId.current === id) return;
    const target = followUps.find(item => item.id === id);
    if (!target) {
      const targetPage = focusPageQuery.data;
      if (targetPage !== undefined && targetPage !== null) {
        setSearchTerm("");
        setStatusFilter("all");
        setPriorityFilter("all");
        setFollowUpsPage(targetPage);
      }
      return;
    }
    handledFocusId.current = id;
    pendingFocusId.current = id;
    setSearchTerm("");
    setStatusFilter("all");
    setPriorityFilter("all");
  }, [requestedFollowUpId, isLoading, followUps, focusPageQuery.data, setFollowUpsPage]);

  useEffect(() => {
    const id = pendingFocusId.current;
    if (id === null || isLoading || !filteredFollowUps.some(item => item.id === id)) return;
    const row = document.getElementById(`manual-followup-${id}`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.focus({ preventScroll: true });
    pendingFocusId.current = null;
  }, [filteredFollowUps, isLoading]);

  const clearFollowUpFocus = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setSearchTerm("");
    setStatusFilter("all");
    setPriorityFilter("all");
    navigate("/follow-up");
  };

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

  const { data: deliverySummary } = useQuery<{ bounced: number; failed: number; spam: number; total: number }>({
    queryKey: ["/api/broker-follow-up-reminders/delivery-summary"],
    refetchInterval: 60_000,
  });

  return (
    <PageShell
      title="Followups"
      subtitle="Manage client follow-ups, tasks, and broker payment reminder cadences"
      group="Recovery"
    >
      <PageInsights entity="followups" title="Follow-up workload" />
      {deliverySummary && deliverySummary.total > 0 && (
      <Badge className="ff-badge-rejected gap-1.5">
          {deliverySummary.total} delivery issue{deliverySummary.total !== 1 ? "s" : ""} —&nbsp;
          {deliverySummary.bounced > 0 && `${deliverySummary.bounced} bounced`}
          {deliverySummary.bounced > 0 && deliverySummary.failed > 0 && ", "}
          {deliverySummary.failed > 0 && `${deliverySummary.failed} failed`}
          {(deliverySummary.bounced > 0 || deliverySummary.failed > 0) && deliverySummary.spam > 0 && ", "}
          {deliverySummary.spam > 0 && `${deliverySummary.spam} spam`}
        </Badge>
      )}

      <Dialog open={isAddingFollowUp} onOpenChange={setIsAddingFollowUp}>
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

            {/* Tabs */}
            <Tabs defaultValue="collections">
              <TabsList className="mb-4">
                <TabsTrigger value="collections" className="flex items-center gap-2" data-testid="collections-automation-tab">
                  <FileText className="h-4 w-4" />
                  VP / RPS Collections
                </TabsTrigger>
                <TabsTrigger value="manual" className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Manual Tasks
                  {followUpsTotal > 0 && (
                    <span className="ff-followups-count ml-1">
                      {followUpsTotal}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="broker" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Broker Automations
                  {pendingBfuCount > 0 && (
                    <span className="ff-followups-count ml-1">
                      {pendingBfuCount}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="confirmation" className="flex items-center gap-2" data-testid="confirmation-followups-tab">
                  <CheckCircle className="h-4 w-4" />
                  Receipt Confirmation
                </TabsTrigger>
                <TabsTrigger value="templates" className="flex items-center gap-2">
                  <LayoutTemplate className="h-4 w-4" />
                  Templates
                  <span className="ff-followups-count ml-1">
                    {templates.length}
                  </span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="collections">
                <CollectionsAutomation />
              </TabsContent>

              <TabsContent value="confirmation">
                <ConfirmationFollowUpQueue />
              </TabsContent>

              {/* ── Manual follow-ups ─────────────────────────────────────────── */}
              <TabsContent value="manual">
                {requestedFollowUpId && /^\d+$/.test(requestedFollowUpId) && (
                  <div data-testid="followup-focus-notice" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#e0e0e0] px-3 py-2 text-xs shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
                    <span>Showing manual follow-up #{requestedFollowUpId} from your authorized task list.</span>
                    <a href="/follow-up" onClick={clearFollowUpFocus} data-testid="followup-show-all" className="font-semibold text-[#087c8d] underline underline-offset-2">Show all follow-ups</a>
                  </div>
                )}
                <Card>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-4">
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
                      <Button primary className="flex items-center gap-2" onClick={() => setIsAddingFollowUp(true)}>
                        <Plus className="h-4 w-4" />
                        Add Follow Up
                      </Button>
                    </div>
                  </CardContent>


                <div className="grid gap-4">
                  {isLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
                      <p className="text-gray-600 mt-2">Loading follow-ups...</p>
                    </div>
                  ) : followUpsError ? (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <p role="alert" className="text-sm text-red-700">{followUpsErrorValue instanceof Error ? followUpsErrorValue.message : "Could not load manual follow-ups."}</p>
                        <Button variant="outline" className="mt-3" onClick={() => void refetchFollowUps()}>Retry</Button>
                      </CardContent>
                    </Card>
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
                    <NeuTable>
                      <NeuTableHeader>
                        <NeuTableRow>
                          <NeuTableHead>Task</NeuTableHead>
                          <NeuTableHead>Carrier</NeuTableHead>
                          <NeuTableHead>Due Date</NeuTableHead>
                          <NeuTableHead>Priority</NeuTableHead>
                          <NeuTableHead>Status</NeuTableHead>
                          <NeuTableHead className="text-right">Actions</NeuTableHead>
                        </NeuTableRow>
                      </NeuTableHeader>
                      <NeuTableBody>
                        {filteredFollowUps.map(followUp => (
                          <NeuTableRow
                            key={followUp.id}
                            id={`manual-followup-${followUp.id}`}
                            tabIndex={-1}
                            data-testid={`manual-followup-row-${followUp.id}`}
                            className={cn(followUp.id === Number(requestedFollowUpId) && "outline outline-2 outline-[#087c8d] outline-offset-[-2px]")}
                          >
                            <NeuTableCell>
                              <p className="font-semibold text-slate-900">{followUp.title}</p>
                              {followUp.description && <p className="mt-1 max-w-md text-xs text-slate-500">{followUp.description}</p>}
                            </NeuTableCell>
                            <NeuTableCell>{followUp.client?.name ?? "—"}</NeuTableCell>
                            <NeuTableCell>{format(new Date(followUp.dueDate), "MMM dd, yyyy")}</NeuTableCell>
                            <NeuTableCell>
                              <Badge className={getPriorityColor(followUp.priority)}>{followUp.priority}</Badge>
                            </NeuTableCell>
                            <NeuTableCell>
                              <Badge className={getStatusColor(followUp.status)}>
                                <span className="flex items-center gap-1">{getStatusIcon(followUp.status)}{followUp.status.replace("-", " ")}</span>
                              </Badge>
                            </NeuTableCell>
                            <NeuTableCell>
                              <div className="flex justify-end gap-2">
                                {followUp.status !== "completed" && (
                                  <>
                                    {followUp.status === "pending" && (
                                      <Button size="sm" variant="outline" onClick={() => updateStatusMutation.mutate({ id: followUp.id, status: "in-progress" })}>Start</Button>
                                    )}
                                    <Button primary size="sm" onClick={() => updateStatusMutation.mutate({ id: followUp.id, status: "completed" })}>Complete</Button>
                                  </>
                                )}
                              </div>
                            </NeuTableCell>
                          </NeuTableRow>
                        ))}
                      </NeuTableBody>
                    </NeuTable>
                  )}
                  {!isLoading && !followUpsError && (
                    <ServerArrayPagination
                      page={followUpsPage}
                      pageCount={followUpsPageCount}
                      total={followUpsTotal}
                      onPageChange={setFollowUpsPage}
                      disabled={followUpsFetching}
                    />
                  )}
                </div>
                </Card>
              </TabsContent>

              {/* ── Broker automations ────────────────────────────────────────── */}
              <TabsContent value="broker" className="recovery-neu-surface border-0 p-4">
                <div className="flex items-start gap-3 rounded-2xl bg-[#e0e0e0] px-4 py-3 shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8]">
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
                          "overflow-hidden rounded-2xl bg-[#e0e0e0] shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8] transition-shadow",
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
                              <Badge className={cn(
                                "gap-1",
                                bfu.triggerType === "auto"
                                  ? "ff-followups-source-rules"
                                  : "ff-followups-source-agent",
                              )}>
                                {bfu.triggerType === "auto" ? <Zap className="h-3 w-3" /> : <User className="h-3 w-3" />}
                                {bfu.triggerType === "auto" ? "Rules" : "Agent"}
                              </Badge>
                            </div>
                            {/* Status */}
                            <div>
                              <Badge className={cn(
                                "gap-1 capitalize",
                                BFU_STATUS_COLOR[bfu.status] ?? "bg-gray-50 text-gray-600 border-gray-200",
                              )}>
                                {bfu.status === "acknowledged" && <CheckCheck className="h-3 w-3" />}
                                {bfu.status === "sent" && <Mail className="h-3 w-3" />}
                                {bfu.status}
                              </Badge>
                            </div>
                            {/* Cadence paused badge */}
                            {cadence?.paused && (
                              <Badge className="ff-badge-pending gap-1">
                                <Pause className="h-2.5 w-2.5" /> Paused
                              </Badge>
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
                            <div className="mx-2 mb-2 rounded-xl bg-[#e0e0e0] px-5 py-4 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
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
                                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-[#e0e0e0] p-3 font-sans text-[11.5px] text-slate-600 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
                                      {bfu.body}
                                    </pre>
                                  </div>
                                  {bfu.notes && <div className="rounded-xl bg-[#e0e0e0] p-3 text-xs shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]">
                                    <p className="mb-1 font-semibold text-[#777]">Legacy follow-up note · read-only</p>
                                    <p className="whitespace-pre-wrap">{bfu.notes}</p>
                                  </div>}
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
                                  {/* Suppress cadence button */}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-3 text-[12px] w-full border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20"
                                    disabled={suppressMutation.isPending}
                                    onClick={e => { e.stopPropagation(); if (confirm("Cancel all pending reminders for this follow-up?")) suppressMutation.mutate(bfu.id); }}
                                  >
                                    <ShieldOff className="h-3.5 w-3.5 mr-1.5" />
                                    Suppress All Reminders
                                  </Button>
                                </div>
                              </div>
                              <div className="mt-5">
                                <EntityNotes key={`followup:${bfu.id}`} entityType="followup" entityId={bfu.id} />
                              </div>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {/* ── Templates tab ─────────────────────────────────────────── */}
              <TabsContent value="templates" className="recovery-neu-surface border-0 p-4">
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Email Templates</h2>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Customise the email subject and body sent at each trigger point. The automation engine uses the
                      default template for each trigger type.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="flex items-center gap-1.5"
                    onClick={() => { setEditingTpl(null); setTplDialogOpen(true); }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New Template
                  </Button>
                </div>

                {tplLoading ? (
                  <div className="flex items-center justify-center h-40 text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading templates…
                  </div>
                ) : templates.length === 0 ? (
                    <Card>
                    <CardContent className="flex flex-col items-center justify-center py-16 text-slate-400">
                      <LayoutTemplate className="h-10 w-10 mb-3 opacity-40" />
                      <p className="text-sm font-medium">No templates yet</p>
                      <p className="text-[12px] mt-1">Create your first template above to override the built-in defaults.</p>
                    </CardContent>
                  </Card>
                ) : (
                  /* Group templates by trigger type */
                  (["immediate", "due_date", "overdue", "escalation"] as const).map(tt => {
                    const group = (templates as BrokerFollowUpTemplate[]).filter(t => t.triggerType === tt);
                    if (group.length === 0) return null;
                    return (
                      <div key={tt}>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={cn(
                            TRIGGER_TYPE_COLORS[tt],
                          )}>
                            {TRIGGER_TYPE_LABELS[tt]}
                          </Badge>
                          <span className="text-[11px] text-slate-400">{group.length} template{group.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="space-y-2">
                          {group.map(tpl => (
                            <Card
                              key={tpl.id}
                              className={cn(
                                "rounded-2xl bg-[#e0e0e0] shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8] transition-colors",
                                tpl.isDefault && "border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-950/10",
                              )}
                            >
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-[13px] font-semibold text-slate-900 dark:text-white">{tpl.name}</span>
                                      {tpl.isDefault && (
                                        <Badge className="ff-badge-submitted gap-1">
                                          <Star className="h-2.5 w-2.5" /> Default
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                                      <span className="font-medium text-slate-600 dark:text-slate-300">Subject: </span>
                                      {tpl.subject}
                                    </p>
                                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-xl">
                                      {tpl.body.slice(0, 120)}{tpl.body.length > 120 ? "…" : ""}
                                    </p>
                                  </div>
                                  {/* Actions */}
                                  <div className="flex items-center gap-1 shrink-0">
                                    {!tpl.isDefault && (
                                      <Button
                                        type="button"
                                        title="Set as default"
                                        disabled={setDefaultTplMutation.isPending}
                                        onClick={() => setDefaultTplMutation.mutate(tpl.id)}
                                        className="!min-h-8 flex items-center gap-1 px-2 py-1 text-[11px]"
                                      >
                                        <Star className="h-3 w-3" /> Set default
                                      </Button>
                                    )}
                                    <Button
                                      type="button"
                                      title="Preview"
                                      onClick={() => setPreviewTpl(tpl)}
                                      className="!min-h-8 !w-8 !rounded-full !p-0"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      type="button"
                                      title="Edit"
                                      onClick={() => { setEditingTpl(tpl); setTplDialogOpen(true); }}
                                      className="!min-h-8 !w-8 !rounded-full !p-0"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      type="button"
                                      title="Delete"
                                      disabled={deleteTplMutation.isPending}
                                      onClick={() => { if (confirm(`Delete template "${tpl.name}"?`)) deleteTplMutation.mutate(tpl.id); }}
                                      className="!min-h-8 !w-8 !rounded-full !p-0 !text-red-700"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Placeholder legend */}
                <Card className="border border-dashed border-[#bdc8c5]">
                  <CardContent className="p-4">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Available placeholders</p>
                    <div className="flex flex-wrap gap-1.5">
                      {PLACEHOLDERS.map(ph => (
                        <span
                          key={ph}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-mono text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          <Copy className="h-2.5 w-2.5 opacity-50" />
                          {ph}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Placeholders are substituted at send time from invoice and broker data.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* ── Template create/edit dialog ───────────────────────────────── */}
            <TemplateDialog
              open={tplDialogOpen}
              onOpenChange={setTplDialogOpen}
              initial={editingTpl}
              onSaved={() => qc.invalidateQueries({ queryKey: ["/api/broker-follow-up-templates"] })}
            />

            {/* ── Template preview dialog ───────────────────────────────────── */}
            <Dialog open={!!previewTpl} onOpenChange={v => { if (!v) setPreviewTpl(null); }}>
              <DialogContent className="sm:max-w-[580px]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Template Preview — {previewTpl?.name}
                  </DialogTitle>
                </DialogHeader>
                {previewTpl && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "ff-badge",
                        TRIGGER_TYPE_COLORS[previewTpl.triggerType],
                      )}>
                        {TRIGGER_TYPE_LABELS[previewTpl.triggerType]}
                      </span>
                      {previewTpl.isDefault && (
                        <Badge className="ff-badge-submitted gap-1">
                          <Star className="h-2.5 w-2.5" /> Default
                        </Badge>
                      )}
                    </div>
                    <div className="overflow-hidden rounded-2xl bg-[#e0e0e0] shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8]">
                      <div className="bg-slate-50 dark:bg-slate-800 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">Subject</p>
                        <p className="text-[13px] font-medium text-slate-800 dark:text-slate-200">
                          {applyPreview(previewTpl.subject)}
                        </p>
                      </div>
                      <div className="p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Body (sample data)</p>
                        <pre className="text-[12px] whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300 max-h-72 overflow-auto leading-relaxed">
                          {applyPreview(previewTpl.body)}
                        </pre>
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-1">
                      <p className="text-[11px] text-slate-400">
                        Sample data shown. Actual values filled at send time.
                      </p>
                      <Button size="sm" variant="outline" onClick={() => setPreviewTpl(null)}>Close</Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>

    </PageShell>
  );
}
