import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  GripVertical, Settings2, Zap, ChevronRight, CheckCircle2,
  FileText, Clock, AlertTriangle, Eye, EyeOff, Save,
  RotateCcw, Info, ChevronDown, ChevronUp, ArrowRight,
  Shield, ClipboardCheck, Wallet, ReceiptText, BarChart2,
  Package, FileCheck, Layers, Sparkles,
} from "lucide-react";

// ─── Stage definitions (mirrors server/services/invoiceStage.ts) ──────────────

type StageColor = "slate" | "amber" | "blue" | "violet" | "orange" | "teal" | "indigo" | "emerald";

interface StageConfig {
  id: string;
  label: string;
  description: string;
  color: StageColor;
  step: number;
  // Configurable fields
  enabled: boolean;
  slaHours: number;
  autoAdvance: boolean;
  autoAdvanceCondition: string;
  notes: string;
  requiresApproval: boolean;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
}

const DEFAULT_STAGES: StageConfig[] = [
  {
    id: "document_intake",
    label: "Document Intake",
    description: "Receiving and organizing carrier documents",
    color: "slate",
    step: 1,
    enabled: true,
    slaHours: 4,
    autoAdvance: false,
    autoAdvanceCondition: "all_docs_uploaded",
    notes: "",
    requiresApproval: false,
    notifyOnEnter: true,
    notifyOnExit: false,
  },
  {
    id: "verification",
    label: "Verification",
    description: "Verifying docs, credit, and broker authority",
    color: "amber",
    step: 2,
    enabled: true,
    slaHours: 8,
    autoAdvance: false,
    autoAdvanceCondition: "credit_approved",
    notes: "",
    requiresApproval: true,
    notifyOnEnter: true,
    notifyOnExit: true,
  },
  {
    id: "approval",
    label: "Approval",
    description: "Factor review and funding decision",
    color: "blue",
    step: 3,
    enabled: true,
    slaHours: 24,
    autoAdvance: false,
    autoAdvanceCondition: "",
    notes: "",
    requiresApproval: true,
    notifyOnEnter: true,
    notifyOnExit: true,
  },
  {
    id: "advance",
    label: "Advance",
    description: "Advance payment sent to carrier",
    color: "violet",
    step: 4,
    enabled: true,
    slaHours: 4,
    autoAdvance: true,
    autoAdvanceCondition: "payout_created",
    notes: "",
    requiresApproval: true,
    notifyOnEnter: true,
    notifyOnExit: true,
  },
  {
    id: "collections",
    label: "Collections",
    description: "Collecting payment from broker/debtor",
    color: "orange",
    step: 5,
    enabled: true,
    slaHours: 720,
    autoAdvance: false,
    autoAdvanceCondition: "payment_applied",
    notes: "",
    requiresApproval: false,
    notifyOnEnter: false,
    notifyOnExit: true,
  },
  {
    id: "payment_receipt",
    label: "Payment Receipt",
    description: "Payment received from broker/debtor",
    color: "teal",
    step: 6,
    enabled: true,
    slaHours: 24,
    autoAdvance: true,
    autoAdvanceCondition: "payment_matched",
    notes: "",
    requiresApproval: false,
    notifyOnEnter: true,
    notifyOnExit: false,
  },
  {
    id: "reconciliation",
    label: "Reconciliation",
    description: "Matching payment to outstanding balance",
    color: "indigo",
    step: 7,
    enabled: true,
    slaHours: 48,
    autoAdvance: false,
    autoAdvanceCondition: "",
    notes: "",
    requiresApproval: true,
    notifyOnEnter: false,
    notifyOnExit: false,
  },
  {
    id: "final_settlement",
    label: "Final Settlement",
    description: "Reserve released — invoice fully settled",
    color: "emerald",
    step: 8,
    enabled: true,
    slaHours: 24,
    autoAdvance: true,
    autoAdvanceCondition: "reserve_released",
    notes: "",
    requiresApproval: true,
    notifyOnEnter: true,
    notifyOnExit: true,
  },
];

const STORAGE_KEY = "ff:workflow-builder:stages";
const AUTO_ADVANCE_OPTIONS = [
  { value: "all_docs_uploaded",  label: "All documents uploaded" },
  { value: "credit_approved",    label: "Credit check approved" },
  { value: "payout_created",     label: "Payout record created" },
  { value: "payment_applied",    label: "Payment applied" },
  { value: "payment_matched",    label: "Payment fully matched" },
  { value: "reserve_released",   label: "Reserve balance released" },
  { value: "",                   label: "— none —" },
];

// ─── Color helpers ────────────────────────────────────────────────────────────

const COLOR_DOT: Record<StageColor, string> = {
  slate:   "bg-slate-400",
  amber:   "bg-amber-500",
  blue:    "bg-blue-500",
  violet:  "bg-violet-500",
  orange:  "bg-orange-500",
  teal:    "bg-teal-500",
  indigo:  "bg-indigo-500",
  emerald: "bg-emerald-500",
};

const COLOR_BG: Record<StageColor, string> = {
  slate:   "bg-slate-50 border-slate-200 dark:bg-slate-900/30 dark:border-slate-700",
  amber:   "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/40",
  blue:    "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900/40",
  violet:  "bg-violet-50 border-violet-200 dark:bg-violet-950/20 dark:border-violet-900/40",
  orange:  "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-900/40",
  teal:    "bg-teal-50 border-teal-200 dark:bg-teal-950/20 dark:border-teal-900/40",
  indigo:  "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-900/40",
  emerald: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/40",
};

const COLOR_TEXT: Record<StageColor, string> = {
  slate:   "text-slate-600 dark:text-slate-300",
  amber:   "text-amber-700 dark:text-amber-400",
  blue:    "text-blue-700 dark:text-blue-400",
  violet:  "text-violet-700 dark:text-violet-400",
  orange:  "text-orange-700 dark:text-orange-400",
  teal:    "text-teal-700 dark:text-teal-400",
  indigo:  "text-indigo-700 dark:text-indigo-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
};

const COLOR_ICON: Record<StageColor, string> = {
  slate:   "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  amber:   "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  blue:    "bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  violet:  "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
  orange:  "bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400",
  teal:    "bg-teal-100 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",
  indigo:  "bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
};

const STAGE_ICONS: Record<string, React.ElementType> = {
  document_intake:  FileText,
  verification:     Shield,
  approval:         ClipboardCheck,
  advance:          Wallet,
  collections:      ReceiptText,
  payment_receipt:  Package,
  reconciliation:   BarChart2,
  final_settlement: CheckCircle2,
};

// ─── Persistence helpers ──────────────────────────────────────────────────────

function loadStages(): StageConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved: StageConfig[] = JSON.parse(raw);
      // Merge with defaults so new fields are picked up
      return saved.map(s => ({ ...DEFAULT_STAGES.find(d => d.id === s.id) ?? s, ...s }));
    }
  } catch {}
  return DEFAULT_STAGES.map(s => ({ ...s }));
}

function saveStages(stages: StageConfig[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stages)); } catch {}
}

// ─── Stage card ───────────────────────────────────────────────────────────────

interface StageCardProps {
  stage: StageConfig;
  index: number;
  total: number;
  expanded: boolean;
  dragging: boolean;
  dragOver: boolean;
  onToggleExpand: () => void;
  onChange: (updates: Partial<StageConfig>) => void;
  onDragStart: (e: React.DragEvent, idx: number) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDrop: (e: React.DragEvent, idx: number) => void;
}

function StageCard({
  stage, index, total, expanded, dragging, dragOver,
  onToggleExpand, onChange,
  onDragStart, onDragEnd, onDragOver, onDrop,
}: StageCardProps) {
  const Icon = STAGE_ICONS[stage.id] ?? Layers;

  const slaLabel =
    stage.slaHours < 1    ? `${stage.slaHours * 60}m`
    : stage.slaHours < 24  ? `${stage.slaHours}h`
    : stage.slaHours < 168 ? `${Math.round(stage.slaHours / 24)}d`
    :                        `${Math.round(stage.slaHours / 168)}w`;

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, index)}
      onDragEnd={onDragEnd}
      onDragOver={e => { e.preventDefault(); onDragOver(e, index); }}
      onDrop={e => onDrop(e, index)}
      className={cn(
        "group rounded-[14px] border transition-all duration-150 select-none",
        dragOver
          ? "border-blue-400 bg-blue-50/60 shadow-[0_0_0_2px_rgba(59,130,246,0.25)] dark:border-blue-600 dark:bg-blue-950/20"
          : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]",
        dragging ? "opacity-40 scale-[0.98]" : "opacity-100",
        !stage.enabled && "opacity-60",
      )}
    >
      {/* ── Header row ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Drag handle */}
        <div
          className="cursor-grab touch-none active:cursor-grabbing"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4 text-slate-300 group-hover:text-slate-400 dark:text-slate-700 dark:group-hover:text-slate-500" />
        </div>

        {/* Step number */}
        <div className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
          stage.enabled
            ? `${COLOR_ICON[stage.color]}`
            : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600"
        )}>
          {stage.enabled ? index + 1 : <EyeOff className="h-3 w-3" />}
        </div>

        {/* Icon */}
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]",
          COLOR_ICON[stage.color],
          !stage.enabled && "!bg-slate-100 !text-slate-400 dark:!bg-slate-800 dark:!text-slate-600"
        )}>
          <Icon className="h-4 w-4" />
        </div>

        {/* Label + badges */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              "text-[13.5px] font-semibold",
              stage.enabled ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-slate-600"
            )}>
              {stage.label}
            </span>
            {stage.autoAdvance && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10.5px] font-semibold text-violet-700 dark:border-violet-900/40 dark:bg-violet-950/20 dark:text-violet-400">
                <Zap className="h-2.5 w-2.5" /> Auto
              </span>
            )}
            {stage.requiresApproval && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-400">
                <Shield className="h-2.5 w-2.5" /> Gated
              </span>
            )}
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10.5px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              SLA {slaLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-slate-400 dark:text-slate-500">
            {stage.description}
          </p>
        </div>

        {/* Controls */}
        <div className="flex shrink-0 items-center gap-3">
          {/* Enable toggle */}
          <label className="flex cursor-pointer items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <Switch
              checked={stage.enabled}
              onCheckedChange={v => onChange({ enabled: v })}
              className="data-[state=checked]:bg-emerald-500"
            />
            <span className="hidden text-[11px] text-slate-400 sm:inline">
              {stage.enabled ? "On" : "Off"}
            </span>
          </label>

          {/* Expand toggle */}
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title={expanded ? "Collapse" : "Configure"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── Expanded config ─────────────────────────────────────────── */}
      {expanded && (
        <div className={cn(
          "border-t px-4 pb-4 pt-3",
          "border-slate-100 dark:border-slate-800"
        )}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">

            {/* SLA */}
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <Clock className="h-3 w-3" /> SLA (hours)
              </label>
              <Input
                type="number"
                min={0}
                value={stage.slaHours}
                onChange={e => onChange({ slaHours: Number(e.target.value) || 0 })}
                className="h-8 rounded-lg text-sm"
              />
              <p className="mt-1 text-[10.5px] text-slate-400">
                Alert when stage exceeds this duration
              </p>
            </div>

            {/* Auto-advance condition */}
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <Zap className="h-3 w-3" /> Auto-advance condition
              </label>
              <select
                value={stage.autoAdvanceCondition}
                onChange={e => onChange({ autoAdvanceCondition: e.target.value, autoAdvance: !!e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {AUTO_ADVANCE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="mt-1 text-[10.5px] text-slate-400">
                Move automatically when condition is met
              </p>
            </div>

            {/* Toggles */}
            <div className="space-y-2.5">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Options
              </label>
              <div className="space-y-2">
                {[
                  { field: "requiresApproval" as keyof StageConfig, label: "Requires manager approval", icon: Shield },
                  { field: "notifyOnEnter"    as keyof StageConfig, label: "Notify on stage entry",      icon: Info  },
                  { field: "notifyOnExit"     as keyof StageConfig, label: "Notify on stage exit",       icon: Info  },
                ].map(({ field, label, icon: Ico }) => (
                  <label key={field} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 hover:border-slate-200 dark:border-slate-800 dark:bg-slate-900/30 dark:hover:border-slate-700">
                    <span className="flex items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-400">
                      <Ico className="h-3 w-3" />
                      {label}
                    </span>
                    <Switch
                      checked={!!stage[field]}
                      onCheckedChange={v => onChange({ [field]: v })}
                      className="shrink-0 data-[state=checked]:bg-blue-600"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Notes (spans full width) */}
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <FileText className="h-3 w-3" /> Stage notes
              </label>
              <Textarea
                value={stage.notes}
                onChange={e => onChange({ notes: e.target.value })}
                rows={2}
                placeholder="Internal notes about this stage — shown to agents when a load enters it…"
                className="resize-none rounded-lg text-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pipeline preview ─────────────────────────────────────────────────────────

function PipelinePreview({ stages }: { stages: StageConfig[] }) {
  const enabled = stages.filter(s => s.enabled);
  return (
    <div className="rounded-[14px] border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <p className="mb-4 text-[11px] font-bold uppercase tracking-wide text-slate-400">Live Pipeline Preview</p>
      <div className="flex flex-wrap items-center gap-y-3">
        {enabled.map((s, i) => {
          const Icon = STAGE_ICONS[s.id] ?? Layers;
          return (
            <div key={s.id} className="flex items-center">
              {/* Node */}
              <div className="flex flex-col items-center gap-1">
                <div className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl border",
                  COLOR_BG[s.color],
                  COLOR_TEXT[s.color],
                )}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className="max-w-[68px] text-center text-[9.5px] font-semibold leading-tight text-slate-500 dark:text-slate-400">
                  {s.label}
                </span>
                {s.autoAdvance && (
                  <span className="text-[9px] text-violet-500"><Zap className="inline h-2.5 w-2.5" /></span>
                )}
              </div>
              {/* Arrow */}
              {i < enabled.length - 1 && (
                <ChevronRight className="mx-1 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-700" />
              )}
            </div>
          );
        })}
        {enabled.length === 0 && (
          <p className="text-sm text-slate-400">All stages are disabled.</p>
        )}
      </div>

      {/* Stats */}
      <div className="mt-4 flex flex-wrap gap-3">
        <Stat label="Active stages" value={enabled.length} />
        <Stat label="Auto-advance" value={enabled.filter(s => s.autoAdvance).length} color="violet" />
        <Stat label="Manager-gated" value={enabled.filter(s => s.requiresApproval).length} color="blue" />
        <Stat label="Max SLA" value={`${enabled.reduce((mx, s) => Math.max(mx, s.slaHours), 0)}h`} color="amber" />
      </div>
    </div>
  );
}

function Stat({ label, value, color = "slate" }: { label: string; value: string | number; color?: string }) {
  const cls: Record<string, string> = {
    slate:  "text-slate-700 dark:text-slate-300",
    violet: "text-violet-700 dark:text-violet-400",
    blue:   "text-blue-700 dark:text-blue-400",
    amber:  "text-amber-700 dark:text-amber-400",
  };
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900/30">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={cn("text-[14px] font-bold", cls[color] ?? cls.slate)}>{value}</p>
    </div>
  );
}

// ─── Document rules mini panel ────────────────────────────────────────────────

interface DocumentRule {
  id: number;
  documentType: string;
  label: string;
  required: boolean;
  requiredForStage: "start_review" | "approve";
  active: boolean;
  sortOrder: number;
}

function DocRulesPanel({ stageId }: { stageId: string | null }) {
  const { data: rules = [] } = useQuery<DocumentRule[]>({ queryKey: ["/api/document-rules"] });
  if (!stageId) return null;

  const stageLabel =
    stageId === "document_intake" || stageId === "verification" ? "start_review" :
    stageId === "approval" ? "approve" : null;

  if (!stageLabel) return null;

  const relevant = rules.filter(r => r.requiredForStage === stageLabel && r.active);
  if (relevant.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/20">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        Required Documents for this stage
      </p>
      <div className="space-y-1">
        {relevant.map(r => (
          <div key={r.id} className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            <span className="text-[11.5px] text-slate-600 dark:text-slate-400">{r.label}</span>
            {!r.required && (
              <span className="text-[10px] text-slate-400">(optional)</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkflowBuilder() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = user?.role === "manager" || user?.role === "admin";

  const [stages, setStages] = useState<StageConfig[]>(loadStages);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [showReset, setShowReset] = useState(false);

  // Drag state
  const dragIdx = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── Helpers ────────────────────────────────────────────────────
  const updateStage = useCallback((id: string, updates: Partial<StageConfig>) => {
    setStages(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    setHasUnsaved(true);
  }, []);

  const save = useCallback(() => {
    // Reassign step numbers based on current order
    const numbered = stages.map((s, i) => ({ ...s, step: i + 1 }));
    setStages(numbered);
    saveStages(numbered);
    setHasUnsaved(false);
    toast({ title: "Workflow saved", description: "Pipeline configuration stored locally." });
  }, [stages, toast]);

  const reset = useCallback(() => {
    const fresh = DEFAULT_STAGES.map(s => ({ ...s }));
    setStages(fresh);
    saveStages(fresh);
    setHasUnsaved(false);
    setShowReset(false);
    toast({ title: "Workflow reset to defaults" });
  }, [toast]);

  // ── Drag-and-drop ──────────────────────────────────────────────
  const onDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragIdx.current = idx;
    setDraggingId(stages[idx].id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  }, [stages]);

  const onDragEnd = useCallback(() => {
    dragIdx.current = null;
    setDraggingId(null);
    setDragOverIdx(null);
  }, []);

  const onDragOver = useCallback((_e: React.DragEvent, idx: number) => {
    setDragOverIdx(idx);
  }, []);

  const onDrop = useCallback((_e: React.DragEvent, dropIdx: number) => {
    const fromIdx = dragIdx.current;
    if (fromIdx === null || fromIdx === dropIdx) {
      setDragOverIdx(null);
      return;
    }
    setStages(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(dropIdx, 0, moved);
      return next;
    });
    setHasUnsaved(true);
    setDragOverIdx(null);
  }, []);

  // Auto-save to localStorage on any change (debounced)
  useEffect(() => {
    const t = setTimeout(() => { if (hasUnsaved) saveStages(stages); }, 800);
    return () => clearTimeout(t);
  }, [stages, hasUnsaved]);

  const enabledCount = stages.filter(s => s.enabled).length;

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Workflow Builder"
          subtitle="Drag to reorder stages, configure SLA targets, auto-advance rules, and approval gates"
          group="Admin"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1200px] p-6 xl:p-8">

            {/* ── Top bar ─────────────────────────────────────────────────── */}
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-[0_4px_12px_rgba(37,99,235,0.25)]">
                    <Layers className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h1 className="text-[18px] font-bold tracking-tight text-slate-900 dark:text-white">
                      Factoring Pipeline
                    </h1>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">
                      {enabledCount} of {stages.length} stages active
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                {hasUnsaved && (
                  <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11.5px] font-semibold text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> Unsaved changes
                  </span>
                )}
                <Button
                  variant="outline"
                  onClick={() => setShowReset(true)}
                  className="gap-1.5 rounded-xl text-xs"
                  disabled={!isManager}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </Button>
                <Button
                  onClick={save}
                  disabled={!hasUnsaved || !isManager}
                  className="gap-1.5 rounded-xl bg-blue-600 text-xs text-white hover:bg-blue-700 shadow-[0_4px_12px_rgba(37,99,235,0.22)]"
                >
                  <Save className="h-3.5 w-3.5" />
                  {hasUnsaved ? "Save Changes" : "Saved"}
                </Button>
              </div>
            </div>

            {/* ── Info banner ──────────────────────────────────────────────── */}
            <div className="mb-5 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/40 dark:bg-blue-950/20">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <div className="text-xs text-blue-700 dark:text-blue-300">
                <span className="font-semibold">Drag stages to reorder · </span>
                Toggle stages on/off to hide them from the pipeline ·
                Configure SLA alerts, auto-advance triggers, and approval gates per stage ·
                Changes are saved locally and applied to the pipeline preview in real time.
              </div>
            </div>

            {!isManager && (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  You are viewing in read-only mode. Manager or Admin role required to make changes.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
              {/* ── Left: stage list ───────────────────────────────────────── */}
              <div className="space-y-2.5">
                {stages.map((stage, index) => (
                  <div key={stage.id}>
                    <StageCard
                      stage={stage}
                      index={index}
                      total={stages.length}
                      expanded={expandedId === stage.id}
                      dragging={draggingId === stage.id}
                      dragOver={dragOverIdx === index}
                      onToggleExpand={() => setExpandedId(expandedId === stage.id ? null : stage.id)}
                      onChange={isManager ? (updates) => updateStage(stage.id, updates) : () => {}}
                      onDragStart={isManager ? onDragStart : () => {}}
                      onDragEnd={onDragEnd}
                      onDragOver={isManager ? onDragOver : () => {}}
                      onDrop={isManager ? onDrop : () => {}}
                    />
                    {/* Doc rules hint when expanded */}
                    {expandedId === stage.id && (
                      <div className="ml-[60px]">
                        <DocRulesPanel stageId={stage.id} />
                      </div>
                    )}
                  </div>
                ))}

                {/* Drop zone at end */}
                {isManager && (
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOverIdx(stages.length); }}
                    onDrop={e => onDrop(e, stages.length - 1)}
                    className={cn(
                      "rounded-[14px] border-2 border-dashed py-4 text-center text-[12px] text-slate-300 transition-colors dark:text-slate-700",
                      dragOverIdx === stages.length
                        ? "border-blue-400 text-blue-400 dark:border-blue-600 dark:text-blue-400"
                        : "border-slate-200 dark:border-slate-800"
                    )}
                  >
                    Drop here to move to end
                  </div>
                )}
              </div>

              {/* ── Right: preview + legend ────────────────────────────────── */}
              <div className="space-y-4">
                {/* Pipeline flow preview */}
                <PipelinePreview stages={stages} />

                {/* Legend */}
                <div className="rounded-[14px] border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Legend</p>
                  <div className="space-y-2.5">
                    {[
                      {
                        icon: <GripVertical className="h-4 w-4 text-slate-400" />,
                        label: "Drag to reorder",
                        sub: "Grab the handle and drag a stage up or down",
                      },
                      {
                        icon: <Zap className="h-4 w-4 text-violet-500" />,
                        label: "Auto-advance",
                        sub: "Stage advances automatically when condition is met",
                      },
                      {
                        icon: <Shield className="h-4 w-4 text-blue-500" />,
                        label: "Manager-gated",
                        sub: "Requires manager or admin to approve progression",
                      },
                      {
                        icon: <Clock className="h-4 w-4 text-amber-500" />,
                        label: "SLA alert",
                        sub: "Triggers alert when duration exceeds threshold",
                      },
                      {
                        icon: <EyeOff className="h-4 w-4 text-slate-400" />,
                        label: "Disabled stage",
                        sub: "Hidden from pipeline — loads skip this stage",
                      },
                    ].map(item => (
                      <div key={item.label} className="flex items-start gap-2.5">
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/30">
                          {item.icon}
                        </div>
                        <div>
                          <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">{item.label}</p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500">{item.sub}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick tip */}
                <div className="flex items-start gap-2.5 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-900/40 dark:bg-violet-950/10">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                  <p className="text-[11.5px] text-violet-700 dark:text-violet-400">
                    <span className="font-semibold">Pro tip:</span> Combine auto-advance + SLA alerts for hands-off
                    stages like Payment Receipt and Final Settlement — the system handles transitions automatically
                    and only alerts when something gets stuck.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ── Reset confirmation dialog ─────────────────────────────────────── */}
      <Dialog open={showReset} onOpenChange={setShowReset}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-500" />
              Reset to defaults?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">
            This will restore all stage settings to their original defaults and discard any customizations
            you've made. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReset(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={reset}
              className="rounded-xl bg-amber-500 text-white hover:bg-amber-600"
            >
              Reset Pipeline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
