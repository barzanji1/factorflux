import { useState, useRef, useCallback, useEffect } from "react";
import { AdminPageShell, Card, Badge, Button, DialogContent, Input, useAdminToast } from "@/components/admin-neu/adapters";
import "@/components/admin-neu/admin-neu-page.css";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { PageInsights } from "@/components/PageInsights";
import Sidebar from "@/components/layout/sidebar";
import { TopNav } from "@/components/admin-neu/adapters";
import { Switch } from "@/components/ui/switch";
import { NeuTextarea as Textarea } from "@/styles/neu";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  GripVertical, Settings2, Zap, ChevronRight, CheckCircle2,
  FileText, Clock, AlertTriangle, Eye, EyeOff, Save,
  RotateCcw, Info, ChevronDown, ChevronUp, ArrowUp, ArrowDown,
  Shield, ClipboardCheck, Wallet, ReceiptText, BarChart2,
  Package, FileCheck, Layers, Sparkles, Undo2, Redo2,
  ToggleLeft, ToggleRight, Hash, Database, CheckCheck,
} from "lucide-react";

// ─── Stage definitions ────────────────────────────────────────────────────────

type StageColor = "slate" | "amber" | "blue" | "violet" | "orange" | "teal" | "indigo" | "emerald";

export interface StageConfig {
  id: string;
  label: string;
  description: string;
  color: StageColor;
  step: number;
  enabled: boolean;
  slaHours: number;
  autoAdvance: boolean;
  autoAdvanceCondition: string;
  notes: string;
  requiresApproval: boolean;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
}

export const DEFAULT_STAGES: StageConfig[] = [
  { id: "document_intake",  label: "Document Intake",  description: "Receiving and organizing carrier documents",   color: "slate",   step: 1, enabled: true, slaHours: 4,   autoAdvance: false, autoAdvanceCondition: "all_docs_uploaded", notes: "", requiresApproval: false, notifyOnEnter: true,  notifyOnExit: false },
  { id: "verification",     label: "Verification",     description: "Verifying docs, credit, and broker authority", color: "amber",   step: 2, enabled: true, slaHours: 8,   autoAdvance: false, autoAdvanceCondition: "credit_approved",   notes: "", requiresApproval: true,  notifyOnEnter: true,  notifyOnExit: true  },
  { id: "approval",         label: "Approval",         description: "Factor review and funding decision",           color: "blue",    step: 3, enabled: true, slaHours: 24,  autoAdvance: false, autoAdvanceCondition: "",                  notes: "", requiresApproval: true,  notifyOnEnter: true,  notifyOnExit: true  },
  { id: "advance",          label: "Advance",          description: "Advance payment sent to carrier",              color: "violet",  step: 4, enabled: true, slaHours: 4,   autoAdvance: true,  autoAdvanceCondition: "payout_created",    notes: "", requiresApproval: true,  notifyOnEnter: true,  notifyOnExit: true  },
  { id: "collections",      label: "Collections",      description: "Collecting payment from broker/debtor",        color: "orange",  step: 5, enabled: true, slaHours: 720, autoAdvance: false, autoAdvanceCondition: "payment_applied",   notes: "", requiresApproval: false, notifyOnEnter: false, notifyOnExit: true  },
  { id: "payment_receipt",  label: "Payment Receipt",  description: "Payment received from broker/debtor",          color: "teal",    step: 6, enabled: true, slaHours: 24,  autoAdvance: true,  autoAdvanceCondition: "payment_matched",   notes: "", requiresApproval: false, notifyOnEnter: true,  notifyOnExit: false },
  { id: "reconciliation",   label: "Reconciliation",   description: "Matching payment to outstanding balance",      color: "indigo",  step: 7, enabled: true, slaHours: 48,  autoAdvance: false, autoAdvanceCondition: "",                  notes: "", requiresApproval: true,  notifyOnEnter: false, notifyOnExit: false },
  { id: "final_settlement", label: "Final Settlement", description: "Reserve released — invoice fully settled",     color: "emerald", step: 8, enabled: true, slaHours: 24,  autoAdvance: true,  autoAdvanceCondition: "reserve_released",  notes: "", requiresApproval: true,  notifyOnEnter: true,  notifyOnExit: true  },
];

const STORAGE_KEY = "ff:workflow-builder:stages";

const AUTO_ADVANCE_OPTIONS = [
  { value: "all_docs_uploaded", label: "All documents uploaded" },
  { value: "credit_approved",   label: "Credit check approved" },
  { value: "payout_created",    label: "Payout record created" },
  { value: "payment_applied",   label: "Payment applied" },
  { value: "payment_matched",   label: "Payment fully matched" },
  { value: "reserve_released",  label: "Reserve balance released" },
  { value: "",                  label: "— none —" },
];

// ─── Color maps ───────────────────────────────────────────────────────────────

const COLOR_DOT: Record<StageColor, string> = {
  slate: "bg-slate-400", amber: "bg-amber-500", blue: "bg-blue-500", violet: "bg-violet-500",
  orange: "bg-orange-500", teal: "bg-teal-500", indigo: "bg-indigo-500", emerald: "bg-emerald-500",
};
const COLOR_BG: Record<StageColor, string> = {
  slate:   "bg-slate-50   border-slate-200   dark:bg-slate-900/30   dark:border-slate-700",
  amber:   "bg-amber-50   border-amber-200   dark:bg-amber-950/20   dark:border-amber-900/40",
  blue:    "bg-blue-50    border-blue-200    dark:bg-blue-950/20    dark:border-blue-900/40",
  violet:  "bg-violet-50  border-violet-200  dark:bg-violet-950/20  dark:border-violet-900/40",
  orange:  "bg-orange-50  border-orange-200  dark:bg-orange-950/20  dark:border-orange-900/40",
  teal:    "bg-teal-50    border-teal-200    dark:bg-teal-950/20    dark:border-teal-900/40",
  indigo:  "bg-indigo-50  border-indigo-200  dark:bg-indigo-950/20  dark:border-indigo-900/40",
  emerald: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/40",
};
const COLOR_TEXT: Record<StageColor, string> = {
  slate: "text-slate-600 dark:text-slate-300", amber: "text-amber-700 dark:text-amber-400",
  blue: "text-blue-700 dark:text-blue-400", violet: "text-violet-700 dark:text-violet-400",
  orange: "text-orange-700 dark:text-orange-400", teal: "text-teal-700 dark:text-teal-400",
  indigo: "text-indigo-700 dark:text-indigo-400", emerald: "text-emerald-700 dark:text-emerald-400",
};
const COLOR_ICON: Record<StageColor, string> = {
  slate:   "bg-slate-100   text-slate-500   dark:bg-slate-800   dark:text-slate-400",
  amber:   "bg-amber-100   text-amber-600   dark:bg-amber-950/40  dark:text-amber-400",
  blue:    "bg-blue-100    text-blue-600    dark:bg-blue-950/40   dark:text-blue-400",
  violet:  "bg-violet-100  text-violet-600  dark:bg-violet-950/40 dark:text-violet-400",
  orange:  "bg-orange-100  text-orange-600  dark:bg-orange-950/40 dark:text-orange-400",
  teal:    "bg-teal-100    text-teal-600    dark:bg-teal-950/40   dark:text-teal-400",
  indigo:  "bg-indigo-100  text-indigo-600  dark:bg-indigo-950/40 dark:text-indigo-400",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
};
const COLOR_BADGE: Record<StageColor, string> = {
  slate:   "border-slate-200   bg-slate-50   text-slate-600   dark:border-slate-700   dark:bg-slate-800   dark:text-slate-400",
  amber:   "border-amber-200   bg-amber-50   text-amber-700   dark:border-amber-800   dark:bg-amber-950/20 dark:text-amber-400",
  blue:    "border-blue-200    bg-blue-50    text-blue-700    dark:border-blue-800    dark:bg-blue-950/20  dark:text-blue-400",
  violet:  "border-violet-200  bg-violet-50  text-violet-700  dark:border-violet-800  dark:bg-violet-950/20 dark:text-violet-400",
  orange:  "border-orange-200  bg-orange-50  text-orange-700  dark:border-orange-800  dark:bg-orange-950/20 dark:text-orange-400",
  teal:    "border-teal-200    bg-teal-50    text-teal-700    dark:border-teal-800    dark:bg-teal-950/20  dark:text-teal-400",
  indigo:  "border-indigo-200  bg-indigo-50  text-indigo-700  dark:border-indigo-800  dark:bg-indigo-950/20 dark:text-indigo-400",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400",
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

// ─── Persistence ──────────────────────────────────────────────────────────────

function mergeWithDefaults(saved: StageConfig[]): StageConfig[] {
  return saved.map(s => ({ ...DEFAULT_STAGES.find(d => d.id === s.id) ?? s, ...s }));
}

function localSave(stages: StageConfig[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stages)); } catch {}
}

// ─── SLA label ────────────────────────────────────────────────────────────────

function slaLabel(h: number) {
  if (h < 1)   return `${Math.round(h * 60)}m`;
  if (h < 24)  return `${h}h`;
  if (h < 168) return `${Math.round(h / 24)}d`;
  return `${Math.round(h / 168)}w`;
}

// ─── Stage card ───────────────────────────────────────────────────────────────

function StageCard({
  stage, index, total, expanded, dragging, dropBefore, invoiceCount, disabled,
  onToggleExpand, onChange, onMoveUp, onMoveDown,
  onDragStart, onDragEnd, onDragEnter, onDragLeave, onDrop,
}: {
  stage: StageConfig;
  index: number;
  total: number;
  expanded: boolean;
  dragging: boolean;
  dropBefore: boolean;
  invoiceCount: number;
  disabled: boolean;
  onToggleExpand: () => void;
  onChange: (u: Partial<StageConfig>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: (e: React.DragEvent, i: number) => void;
  onDragEnd: () => void;
  onDragEnter: (e: React.DragEvent, i: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, i: number) => void;
}) {
  const Icon = STAGE_ICONS[stage.id] ?? Layers;
  const enabledSeq = index + 1;

  return (
    <div className="relative">
      {/* ── Drop indicator line ──────────────────────────────────────── */}
      <div className={cn(
        "absolute -top-[3px] left-8 right-0 h-[3px] rounded-full transition-all duration-100",
        dropBefore
          ? "bg-blue-500 opacity-100 shadow-[0_0_6px_rgba(59,130,246,0.6)]"
          : "opacity-0",
      )} />

      <Card
        draggable={!disabled}
        onDragStart={e => onDragStart(e, index)}
        onDragEnd={onDragEnd}
        onDragEnter={e => { e.preventDefault(); onDragEnter(e, index); }}
        onDragLeave={onDragLeave}
        onDragOver={e => e.preventDefault()}
        onDrop={e => onDrop(e, index)}
        className={cn(
          "ff-workflow-stage group border transition-all duration-150 select-none",
          dragging
            ? "opacity-30 scale-[0.97] border-slate-300 dark:border-slate-700"
            : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]",
          !stage.enabled && !dragging && "opacity-60",
        )}
      >
        {/* ── Header row ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 px-4 py-3">

          {/* Drag handle + move buttons */}
          <div className="flex shrink-0 flex-col items-center gap-0.5">
            <div
              className={cn(
                "cursor-grab touch-none active:cursor-grabbing",
                disabled && "cursor-default opacity-30",
              )}
              title="Drag to reorder"
            >
              <GripVertical className="h-4 w-4 text-slate-300 group-hover:text-slate-400 dark:text-slate-700 dark:group-hover:text-slate-500 transition-colors" />
            </div>
          </div>

          {/* Up/Down buttons */}
          <div className="flex shrink-0 flex-col gap-0.5">
            <Button
              type="button"
              onClick={onMoveUp}
              disabled={disabled || index === 0}
               className="!min-h-8 !h-8 !w-8 !rounded-full !p-0 text-slate-600 disabled:opacity-20"
              title="Move up"
            >
              <ArrowUp className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              onClick={onMoveDown}
              disabled={disabled || index === total - 1}
               className="!min-h-8 !h-8 !w-8 !rounded-full !p-0 text-slate-600 disabled:opacity-20"
              title="Move down"
            >
              <ArrowDown className="h-3 w-3" />
            </Button>
          </div>

          {/* Step number */}
          <div className={cn(
             "ff-workflow-stage-number flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
             stage.enabled ? "" : "opacity-50",
          )}>
            {stage.enabled ? enabledSeq : <EyeOff className="h-3 w-3" />}
          </div>

          {/* Icon */}
          <div className={cn(
             "ff-workflow-stage-icon flex h-8 w-8 shrink-0 items-center justify-center",
            COLOR_ICON[stage.color],
            !stage.enabled && "!bg-slate-100 !text-slate-400 dark:!bg-slate-800 dark:!text-slate-600",
          )}>
            <Icon className="h-4 w-4" />
          </div>

          {/* Label + badges */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn(
                "text-[13.5px] font-semibold",
                stage.enabled ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-slate-600",
              )}>
                {stage.label}
              </span>
              {stage.autoAdvance && (
                <Badge className="ff-badge ff-workflow-auto">
                  <Zap className="h-2.5 w-2.5" /> Auto
                </Badge>
              )}
              {stage.requiresApproval && (
                <Badge className="ff-badge ff-workflow-gated">
                  <Shield className="h-2.5 w-2.5" /> Gated
                </Badge>
              )}
              <span className="ff-badge ff-badge-draft">
                SLA {slaLabel(stage.slaHours)}
              </span>
              {invoiceCount > 0 && (
                <span className={cn(
                  "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-bold",
                  COLOR_BADGE[stage.color],
                )}>
                  <Hash className="h-2.5 w-2.5" />{invoiceCount} active
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11.5px] text-slate-400 dark:text-slate-500">
              {stage.description}
            </p>
          </div>

          {/* Controls */}
          <div className="flex shrink-0 items-center gap-2.5">
            <label className="flex cursor-pointer items-center gap-1.5" onClick={e => e.stopPropagation()}>
              <Switch
                checked={stage.enabled}
                onCheckedChange={v => onChange({ enabled: v })}
                disabled={disabled}
                className="ff-workflow-switch"
              />
              <span className="hidden text-[11px] text-slate-400 sm:inline">
                {stage.enabled ? "On" : "Off"}
              </span>
            </label>
            <Button
              type="button"
              onClick={onToggleExpand}
              className="!min-h-8 !h-8 !w-8 !rounded-full !p-0"
              title={expanded ? "Collapse" : "Configure"}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* ── Expanded config ──────────────────────────────────────────── */}
        {expanded && (
          <div className="border-t border-slate-100 dark:border-slate-800 px-4 pb-4 pt-3">
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
                  disabled={disabled}
                  className="h-8 text-sm"
                />
                <p className="mt-1 text-[10.5px] text-slate-400">Alert when stage exceeds this</p>
              </div>

              {/* Auto-advance */}
              <div>
                <label className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <Zap className="h-3 w-3" /> Auto-advance condition
                </label>
                <select
                  value={stage.autoAdvanceCondition}
                  onChange={e => onChange({ autoAdvanceCondition: e.target.value, autoAdvance: !!e.target.value })}
                  disabled={disabled}
                  className="h-8 w-full border border-input bg-background px-2.5 text-sm disabled:opacity-50"
                >
                  {AUTO_ADVANCE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10.5px] text-slate-400">Move automatically when met</p>
              </div>

              {/* Toggles */}
              <div className="space-y-2">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Options
                </label>
                {[
                  { field: "requiresApproval" as keyof StageConfig, label: "Requires manager approval", icon: Shield },
                  { field: "notifyOnEnter"    as keyof StageConfig, label: "Notify on stage entry",      icon: Info  },
                  { field: "notifyOnExit"     as keyof StageConfig, label: "Notify on stage exit",       icon: Info  },
                ].map(({ field, label, icon: Ico }) => (
                  <label key={field} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 hover:border-slate-200 dark:border-slate-800 dark:bg-slate-900/30 dark:hover:border-slate-700">
                    <span className="flex items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-400">
                      <Ico className="h-3 w-3" />{label}
                    </span>
                    <Switch
                      checked={!!stage[field]}
                      onCheckedChange={v => onChange({ [field]: v })}
                      disabled={disabled}
                    className="ff-workflow-switch shrink-0"
                    />
                  </label>
                ))}
              </div>

              {/* Notes */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <FileText className="h-3 w-3" /> Stage notes
                </label>
                <Textarea
                  value={stage.notes}
                  onChange={e => onChange({ notes: e.target.value })}
                  disabled={disabled}
                  rows={2}
                  placeholder="Internal notes shown to agents when a load enters this stage…"
                  className="resize-none text-sm"
                />
              </div>
            </div>

            {/* Required docs hint */}
            <DocRulesHint stageId={stage.id} />
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Doc rules hint ───────────────────────────────────────────────────────────

interface DocumentRule {
  id: number; documentType: string; label: string; required: boolean;
  requiredForStage: "start_review" | "approve"; active: boolean; sortOrder: number;
}

function DocRulesHint({ stageId }: { stageId: string }) {
  const { data: rules = [] } = useQuery<DocumentRule[]>({ queryKey: ["/api/document-rules"] });
  const stageLabel =
    stageId === "document_intake" || stageId === "verification" ? "start_review" :
    stageId === "approval" ? "approve" : null;
  if (!stageLabel) return null;
  const relevant = (rules as DocumentRule[]).filter(r => r.requiredForStage === stageLabel && r.active);
  if (relevant.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/20">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        Required documents for this stage
      </p>
      <div className="flex flex-wrap gap-2">
        {relevant.map(r => (
          <span key={r.id} className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            <span className="text-slate-600 dark:text-slate-400">{r.label}</span>
            {!r.required && <span className="text-[10px] text-slate-400">(opt)</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Pipeline preview ─────────────────────────────────────────────────────────

function PipelinePreview({
  stages, stageCounts,
}: { stages: StageConfig[]; stageCounts: Record<string, number> }) {
  const enabled = stages.filter(s => s.enabled);
  const totalSla = enabled.reduce((s, x) => s + x.slaHours, 0);
  const totalActive = enabled.reduce((s, x) => s + (stageCounts[x.id] ?? 0), 0);

  return (
    <Card className="ff-workflow-surface ff-workflow-preview">
      <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Live Pipeline Preview</p>
      </div>
      <div className="p-4 overflow-x-auto">
        <div className="flex items-start gap-1 min-w-max">
          {enabled.map((s, i) => {
            const Icon = STAGE_ICONS[s.id] ?? Layers;
            const count = stageCounts[s.id] ?? 0;
            return (
              <div key={s.id} className="flex items-center">
                <div className="flex flex-col items-center gap-1.5 w-[76px]">
                  <div className={cn(
                      "ff-workflow-preview-stage relative flex h-10 w-10 items-center justify-center border-2 transition-all",
                    COLOR_BG[s.color], COLOR_TEXT[s.color],
                  )}>
                    <Icon className="h-4.5 w-4.5" />
                    {count > 0 && (
                      <span className={cn(
                        "absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border text-[9px] font-bold",
                        COLOR_BADGE[s.color],
                      )}>
                        {count}
                      </span>
                    )}
                  </div>
                  <span className="text-center text-[9.5px] font-semibold leading-tight text-slate-500 dark:text-slate-400 max-w-[72px]">
                    {s.label}
                  </span>
                  <div className="flex items-center gap-1">
                    {s.autoAdvance && <Zap className="h-2.5 w-2.5 text-violet-500" aria-label="Auto-advance" />}
                    {s.requiresApproval && <Shield className="h-2.5 w-2.5 text-blue-500" aria-label="Requires approval" />}
                  </div>
                  <span className="text-[9px] text-slate-400">{slaLabel(s.slaHours)}</span>
                </div>
                {i < enabled.length - 1 && (
                  <ChevronRight className="ff-workflow-connector mx-0.5 h-4 w-4 shrink-0" />
                )}
              </div>
            );
          })}
          {enabled.length === 0 && (
            <p className="py-4 text-sm text-slate-400">All stages are disabled.</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-3 flex flex-wrap gap-3">
        {[
          { label: "Active stages",  value: enabled.length,                                         color: "slate"  },
          { label: "Active invoices",value: totalActive,                                             color: "blue"   },
          { label: "Auto-advance",   value: enabled.filter(s => s.autoAdvance).length,              color: "violet" },
          { label: "Manager-gated",  value: enabled.filter(s => s.requiresApproval).length,         color: "blue"   },
          { label: "Total SLA",      value: slaLabel(totalSla),                                     color: "amber"  },
        ].map(({ label, value, color }) => (
          <div key={label} className="ff-workflow-summary-stat px-3 py-1.5">
            <p className="text-[10px] text-slate-400">{label}</p>
            <p className={cn(
              "text-[14px] font-bold",
              color === "slate"  ? "text-slate-700 dark:text-slate-300" :
              color === "violet" ? "text-violet-700 dark:text-violet-400" :
              color === "blue"   ? "text-blue-700 dark:text-blue-400" :
              color === "amber"  ? "text-amber-700 dark:text-amber-400" : "",
            )}>
              {value}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const MAX_HISTORY = 30;

export default function WorkflowBuilder() {
  const { user } = useAuth();
  const { toast } = useAdminToast();
  const isManager = user?.role === "manager" || user?.role === "admin";

  // ── Server config ───────────────────────────────────────────────────────────
  const { data: serverConfig, isLoading: configLoading } = useQuery<{ stagesJson: StageConfig[] }>({
    queryKey: ["/api/workflow-config"],
  });

  // ── Invoice counts per stage ────────────────────────────────────────────────
  const { data: invoices = [] } = useQuery<{ factoringStage: string | null }[]>({
    queryKey: ["/api/invoices", { all: true }],
    select: (data: any[]) => data.map((d: any) => ({ factoringStage: d.factoringStage })),
  });
  const stageCounts: Record<string, number> = {};
  for (const inv of invoices as any[]) {
    if (inv.factoringStage) {
      stageCounts[inv.factoringStage] = (stageCounts[inv.factoringStage] ?? 0) + 1;
    }
  }

  // ── Stage state + history ───────────────────────────────────────────────────
  const [stages, setStages]         = useState<StageConfig[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return mergeWithDefaults(JSON.parse(raw));
    } catch {}
    return DEFAULT_STAGES.map(s => ({ ...s }));
  });
  const [history, setHistory]       = useState<StageConfig[][]>([]);
  const [future, setFuture]         = useState<StageConfig[][]>([]);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [savedToDb, setSavedToDb]   = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showReset, setShowReset]   = useState(false);

  // Drag state
  const dragIdx     = useRef<number | null>(null);
  const [draggingId, setDraggingId]   = useState<string | null>(null);
  const [dropBeforeIdx, setDropBeforeIdx] = useState<number | null>(null);

  // ── Populate stages from server on first load ───────────────────────────────
  useEffect(() => {
    if (serverConfig?.stagesJson?.length) {
      const merged = mergeWithDefaults(serverConfig.stagesJson);
      setStages(merged);
      localSave(merged);
      setHasUnsaved(false);
    }
  }, [serverConfig]);

  // ── Auto-save to localStorage ───────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { if (hasUnsaved) localSave(stages); }, 600);
    return () => clearTimeout(t);
  }, [stages, hasUnsaved]);

  // ── Keyboard shortcuts (Ctrl+Z / Ctrl+Y / Ctrl+S) ──────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isManager) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (hasUnsaved) save(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // ── History helpers ─────────────────────────────────────────────────────────
  const pushHistory = useCallback((prev: StageConfig[]) => {
    setHistory(h => [...h.slice(-MAX_HISTORY + 1), prev]);
    setFuture([]);
  }, []);

  const applyStages = useCallback((next: StageConfig[], fromHistory = false) => {
    if (!fromHistory) pushHistory(stages);
    setStages(next);
    setHasUnsaved(true);
    setSavedToDb(false);
  }, [stages, pushHistory]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setFuture(f => [stages, ...f]);
    setHistory(h => h.slice(0, -1));
    setStages(prev);
    setHasUnsaved(true);
    setSavedToDb(false);
  }, [history, stages]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setHistory(h => [...h, stages]);
    setFuture(f => f.slice(1));
    setStages(next);
    setHasUnsaved(true);
    setSavedToDb(false);
  }, [future, stages]);

  const updateStage = useCallback((id: string, updates: Partial<StageConfig>) => {
    applyStages(stages.map(s => s.id === id ? { ...s, ...updates } : s));
  }, [stages, applyStages]);

  const moveStage = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const next = [...stages];
    const [moved] = next.splice(fromIdx, 1);
    const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
    next.splice(insertAt, 0, moved);
    applyStages(next.map((s, i) => ({ ...s, step: i + 1 })));
  }, [stages, applyStages]);

  const moveUp   = useCallback((idx: number) => moveStage(idx, idx - 1), [moveStage]);
  const moveDown = useCallback((idx: number) => moveStage(idx, idx + 2), [moveStage]);

  // ── Save mutation ───────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (numbered: StageConfig[]) =>
      apiRequest("PUT", "/api/workflow-config", { stagesJson: numbered }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-config"] });
      setHasUnsaved(false);
      setSavedToDb(true);
      toast({ title: "Workflow saved", description: "Pipeline configuration saved to database." });
      setTimeout(() => setSavedToDb(false), 3000);
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not save to database. Changes are stored locally.", variant: "destructive" });
    },
  });

  const save = useCallback(() => {
    const numbered = stages.map((s, i) => ({ ...s, step: i + 1 }));
    setStages(numbered);
    localSave(numbered);
    saveMutation.mutate(numbered);
  }, [stages, saveMutation]);

  const reset = useCallback(() => {
    const fresh = DEFAULT_STAGES.map(s => ({ ...s }));
    applyStages(fresh);
    setShowReset(false);
    toast({ title: "Reset to defaults" });
  }, [applyStages, toast]);

  // ── Drag handlers ───────────────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragIdx.current = idx;
    setDraggingId(stages[idx].id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  }, [stages]);

  const onDragEnd = useCallback(() => {
    dragIdx.current = null;
    setDraggingId(null);
    setDropBeforeIdx(null);
  }, []);

  const onDragEnter = useCallback((_e: React.DragEvent, idx: number) => {
    setDropBeforeIdx(idx);
  }, []);

  const onDragLeave = useCallback(() => {
    // Only clear if not immediately re-entering another card
  }, []);

  const onDrop = useCallback((_e: React.DragEvent, dropIdx: number) => {
    const fromIdx = dragIdx.current;
    setDropBeforeIdx(null);
    if (fromIdx === null || fromIdx === dropIdx) return;
    const next = [...stages];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(dropIdx, 0, moved);
    applyStages(next.map((s, i) => ({ ...s, step: i + 1 })));
  }, [stages, applyStages]);

  // ── Bulk actions ────────────────────────────────────────────────────────────
  const enableAll  = () => applyStages(stages.map(s => ({ ...s, enabled: true  })));
  const disableAll = () => applyStages(stages.map(s => ({ ...s, enabled: false })));

  const enabledCount = stages.filter(s => s.enabled).length;

  return (
    <div className="ff-workflow-page flex h-[100dvh] min-h-[100dvh] bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Workflow Builder"
          subtitle="Drag to reorder · configure SLA targets · auto-advance rules · approval gates"
          group="Admin"
        />

        <AdminPageShell className="custom-scrollbar flex-1 overflow-auto">
          <PageInsights entity="workflow-builder" title="Workflow activity" />
          <div className="mx-auto w-full max-w-[1200px] p-6 xl:p-8">

            {/* ── Top bar ───────────────────────────────────────────────────── */}
            <div className="ff-workflow-surface mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                 <div className="ff-workflow-stage-icon flex h-9 w-9 items-center justify-center bg-[#27aab8] text-white">
                  <Layers className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <h1 className="text-[18px] font-bold tracking-tight text-slate-900 dark:text-white">
                    Factoring Pipeline
                  </h1>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">
                    {enabledCount} of {stages.length} stages active
                    {savedToDb && (
                      <span className="ml-2 inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                        <CheckCheck className="h-3 w-3" /> Saved to database
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Undo / Redo */}
                <Button
                  type="button"
                  onClick={undo}
                  disabled={!isManager || history.length === 0}
                   className="!min-h-8 !h-8 !w-8 !rounded-full !p-0 disabled:opacity-30"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  onClick={redo}
                  disabled={!isManager || future.length === 0}
                   className="!min-h-8 !h-8 !w-8 !rounded-full !p-0 disabled:opacity-30"
                  title="Redo (Ctrl+Y)"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </Button>

                <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />

                {/* Bulk */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={enableAll}
                  disabled={!isManager}
                   className="gap-1 text-[11.5px] h-8"
                >
                  <ToggleRight className="h-3.5 w-3.5 text-emerald-500" /> Enable All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={disableAll}
                  disabled={!isManager}
                   className="gap-1 text-[11.5px] h-8"
                >
                  <ToggleLeft className="h-3.5 w-3.5 text-slate-400" /> Disable All
                </Button>

                <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowReset(true)}
                  disabled={!isManager}
                   className="gap-1.5 text-[11.5px] h-8"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </Button>
                <Button
                  size="sm"
                  onClick={save}
                  disabled={!hasUnsaved || !isManager || saveMutation.isPending}
                  className={cn(
                    "gap-1.5 text-[11.5px] h-8 transition-all",
                    hasUnsaved
                       ? ""
                      : "bg-slate-100 text-slate-400 dark:bg-slate-800",
                  )}
                  title="Save (Ctrl+S)"
                >
                  {saveMutation.isPending ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {hasUnsaved ? "Save Changes" : "Saved"}
                </Button>
              </div>
            </div>

            {/* ── Banners ───────────────────────────────────────────────────── */}
            {hasUnsaved && (
              <div className="ff-workflow-surface mb-3 flex items-center gap-2 border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="text-[12px] text-amber-700 dark:text-amber-400">
                  You have unsaved changes —
                  <Button onClick={save} className="!min-h-7 !bg-transparent !px-1 !py-0 font-semibold underline-offset-2 !text-[#087f8c] !shadow-none hover:underline" disabled={saveMutation.isPending}>
                    save now
                  </Button>
                  {" "}or press <kbd className="rounded bg-amber-100 px-1 py-0.5 text-[10px] dark:bg-amber-900/40">Ctrl+S</kbd>
                </span>
              </div>
            )}

            <div className="ff-workflow-surface mb-4 flex items-start gap-3 border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/40 dark:bg-blue-950/20">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <div className="text-[12px] text-blue-700 dark:text-blue-300">
                <span className="font-semibold">Drag stages to reorder · use ▲▼ buttons for precise ordering · </span>
                toggle stages on/off · configure SLA, auto-advance, and approval gates per stage ·
                changes are auto-saved locally and can be committed to the database with Save.
                <span className="ml-1 font-medium">Undo/redo supported (Ctrl+Z / Ctrl+Y).</span>
              </div>
            </div>

            {!isManager && (
              <div className="ff-workflow-surface mb-4 flex items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-[12px] text-amber-700 dark:text-amber-400">
                  Read-only mode — Manager or Admin role required to make changes.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_330px]">

              {/* ── Left: stage list ─────────────────────────────────────────── */}
              <div
                className="space-y-2"
                onDragLeave={e => {
                  // If leaving the list container entirely, clear drop indicator
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropBeforeIdx(null);
                  }
                }}
              >
                {stages.map((stage, index) => (
                  <StageCard
                    key={stage.id}
                    stage={stage}
                    index={index}
                    total={stages.length}
                    expanded={expandedId === stage.id}
                    dragging={draggingId === stage.id}
                    dropBefore={dropBeforeIdx === index && draggingId !== stage.id}
                    invoiceCount={stageCounts[stage.id] ?? 0}
                    disabled={!isManager}
                    onToggleExpand={() => setExpandedId(expandedId === stage.id ? null : stage.id)}
                    onChange={updates => updateStage(stage.id, updates)}
                    onMoveUp={() => moveUp(index)}
                    onMoveDown={() => moveDown(index)}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onDragEnter={onDragEnter}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                  />
                ))}

                {/* End drop zone */}
                {isManager && (
                  <div
                    onDragOver={e => { e.preventDefault(); setDropBeforeIdx(stages.length); }}
                    onDragLeave={() => setDropBeforeIdx(null)}
                    onDrop={e => { e.preventDefault(); onDrop(e, stages.length - 1); }}
                    className={cn(
                      "relative rounded-[14px] border-2 border-dashed py-4 text-center text-[12px] transition-colors",
                      dropBeforeIdx === stages.length
                        ? "border-blue-400 bg-blue-50/40 text-blue-500 dark:border-blue-600 dark:bg-blue-950/10"
                        : "border-slate-200 text-slate-300 dark:border-slate-800 dark:text-slate-700",
                    )}
                  >
                    Drop here to place at end
                  </div>
                )}
              </div>

              {/* ── Right: preview panel ─────────────────────────────────────── */}
              <div className="space-y-4">
                {configLoading ? (
                  <div className="ff-workflow-surface flex items-center gap-2 p-4 text-[12px] text-slate-400">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    Loading saved config…
                  </div>
                ) : (
                  <PipelinePreview stages={stages} stageCounts={stageCounts} />
                )}

                {/* Config summary card */}
                <div className="ff-workflow-surface">
                  <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Config Summary</p>
                  </div>
                  <div className="divide-y divide-slate-50 dark:divide-slate-800">
                    {stages.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-2.5 px-4 py-2">
                        <span className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                          s.enabled ? COLOR_ICON[s.color] : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600",
                        )}>
                          {s.enabled ? i + 1 : "–"}
                        </span>
                        <span className={cn(
                          "flex-1 truncate text-[12px] font-medium",
                          s.enabled ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-600",
                        )}>
                          {s.label}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          {s.autoAdvance    && <Zap    className="h-3 w-3 text-violet-400" aria-label="Auto-advance" />}
                          {s.requiresApproval && <Shield className="h-3 w-3 text-blue-400"   aria-label="Requires approval" />}
                          <span className="text-[10px] text-slate-400">{slaLabel(s.slaHours)}</span>
                          {!s.enabled && <EyeOff className="h-3 w-3 text-slate-300" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Keyboard shortcuts cheatsheet */}
                <div className="ff-workflow-surface px-5 py-3">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Keyboard Shortcuts</p>
                  {[
                    ["Ctrl+S", "Save to database"],
                    ["Ctrl+Z", "Undo last change"],
                    ["Ctrl+Y", "Redo"],
                    ["▲▼ buttons", "Move stage up/down"],
                    ["Drag handle", "Free reorder by drag"],
                  ].map(([key, desc]) => (
                    <div key={key} className="flex items-center justify-between py-0.5">
                      <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                        {key}
                      </kbd>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </AdminPageShell>
      </div>

      {/* Reset confirmation dialog */}
      <Dialog open={showReset} onOpenChange={setShowReset}>
         <DialogContent className="ff-workflow-surface sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Reset to Default Pipeline?</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-slate-600 dark:text-slate-400">
            This will restore all 8 stages to their factory settings. Your current configuration will be lost unless you saved it to the database first.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowReset(false)}>Cancel</Button>
            <Button variant="destructive" onClick={reset}>Reset to Defaults</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
