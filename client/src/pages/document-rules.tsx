import { useState } from "react";
import { AdminPageShell, Card, Button, Input, Badge, DialogContent, AlertDialogContent, SelectContent, useAdminToast, StatCard } from "@/components/admin-neu/adapters";
import "@/components/admin-neu/admin-neu-page.css";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Sidebar from "@/components/layout/sidebar";
import { TopNav } from "@/components/admin-neu/adapters";
import { PageInsights } from "@/components/PageInsights";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import {
  FileCheck, Plus, Pencil, Trash2, GripVertical, Shield, CheckCircle2,
  ClipboardCheck, Info, AlertTriangle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocumentRule {
  id: number;
  documentType: string;
  label: string;
  description?: string | null;
  required: boolean;
  requiredForStage: "start_review" | "approve";
  sortOrder: number;
  active: boolean;
  createdAt?: string;
}

// ─── Stage badge ──────────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: "start_review" | "approve" }) {
  return stage === "start_review" ? (
    <Badge className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
      Begin Review
    </Badge>
  ) : (
    <Badge className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
      Approve
    </Badge>
  );
}

// ─── Rule form dialog ─────────────────────────────────────────────────────────

function RuleDialog({
  open,
  rule,
  onClose,
  onSave,
  isSaving,
}: {
  open: boolean;
  rule?: DocumentRule | null;
  onClose: () => void;
  onSave: (data: Partial<DocumentRule>) => void;
  isSaving: boolean;
}) {
  const isEdit = !!rule;
  const [form, setForm] = useState<Partial<DocumentRule>>(
    rule ?? { required: true, requiredForStage: "start_review", active: true, sortOrder: 0 }
  );

  const set = (k: keyof DocumentRule, v: any) => setForm(p => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="ff-rules-surface max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-white">
            <FileCheck className="h-5 w-5 text-blue-500" />
            {isEdit ? "Edit Document Rule" : "Add Document Rule"}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Configure which documents are required and at which stage they must be present.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Document Type <span className="text-red-500">*</span></label>
            <Input
              value={form.documentType ?? ""}
              onChange={e => set("documentType", e.target.value)}
              placeholder="e.g. rate_confirmation"
              className="text-sm"
              disabled={isEdit}
            />
            <p className="text-[11px] text-slate-400">Must match the document type used during upload (snake_case)</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Display Label <span className="text-red-500">*</span></label>
            <Input
              value={form.label ?? ""}
              onChange={e => set("label", e.target.value)}
              placeholder="e.g. Rate Confirmation"
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Description</label>
            <Textarea
              value={form.description ?? ""}
              onChange={e => set("description", e.target.value)}
              placeholder="Explain what this document is and why it's needed..."
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Required For Stage</label>
              <Select value={form.requiredForStage} onValueChange={v => set("requiredForStage", v)}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="start_review">Begin Review</SelectItem>
                  <SelectItem value="approve">Approval</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Sort Order</label>
              <Input
                type="number"
                value={form.sortOrder ?? 0}
                onChange={e => set("sortOrder", parseInt(e.target.value) || 0)}
                className="text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <Switch checked={form.required ?? true} onCheckedChange={v => set("required", v)} />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Required</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <Switch checked={form.active ?? true} onCheckedChange={v => set("active", v)} />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Active</span>
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2">
           <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving} className="text-xs">Cancel</Button>
          <Button
            size="sm"
            disabled={isSaving || !form.documentType || !form.label}
            onClick={() => onSave(form)}
            className="text-xs"
          >
            {isSaving ? "Saving..." : isEdit ? "Save Changes" : "Add Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DocumentRules() {
  const { user } = useAuth();
  const { toast } = useAdminToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";
  const isManager = user?.role === "manager" || isAdmin;

  const [editRule,   setEditRule]   = useState<DocumentRule | null>(null);
  const [showAdd,    setShowAdd]    = useState(false);
  const [deleteId,   setDeleteId]   = useState<number | null>(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: rules = [], isLoading } = useQuery<DocumentRule[]>({
    queryKey: ["/api/document-rules"],
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/document-rules"] });

  const createMut = useMutation({
    mutationFn: (data: Partial<DocumentRule>) =>
      apiRequest("POST", "/api/document-rules", data).then(r => r.json()),
    onSuccess: () => { toast({ title: "Rule added" }); invalidate(); setShowAdd(false); },
    onError:   () => toast({ title: "Error", variant: "destructive", description: "Failed to add rule" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DocumentRule> }) =>
      apiRequest("PUT", `/api/document-rules/${id}`, data).then(r => r.json()),
    onSuccess: () => { toast({ title: "Rule updated" }); invalidate(); setEditRule(null); },
    onError:   () => toast({ title: "Error", variant: "destructive", description: "Failed to update rule" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/document-rules/${id}`),
    onSuccess: () => { toast({ title: "Rule deleted" }); invalidate(); setDeleteId(null); },
    onError:   () => toast({ title: "Error", variant: "destructive", description: "Failed to delete rule" }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, field, value }: { id: number; field: string; value: boolean }) =>
      apiRequest("PUT", `/api/document-rules/${id}`, { [field]: value }).then(r => r.json()),
    onSuccess: () => invalidate(),
  });

  const filteredRules = rules.filter(rule =>
    (stageFilter === "all" || rule.requiredForStage === stageFilter) &&
    (statusFilter === "all" || (statusFilter === "active" ? rule.active : !rule.active))
  );
  const reviewRules   = filteredRules.filter(r => r.requiredForStage === "start_review");
  const approvalRules = filteredRules.filter(r => r.requiredForStage === "approve");

  return (
    <div className="ff-rules-page flex h-[100dvh] min-h-[100dvh] bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Rules" subtitle="Configure required documents for load approval and funding" group="Admin" />

        <AdminPageShell className="custom-scrollbar flex-1 overflow-auto">
          <PageInsights entity="document-rules" title="Document rule activity" />
          <div className="mx-auto w-full max-w-[1000px] p-6 xl:p-8">

            {/* Header */}
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Document Validation Rules</h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Define which documents must be uploaded before an invoice can advance through each lifecycle stage.
                </p>
              </div>
              {isManager && (
                <Button onClick={() => setShowAdd(true)}
                  className="shrink-0 gap-2 text-sm">
                  <Plus className="h-4 w-4" />Add Rule
                </Button>
              )}
            </div>

            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: "Total Rules", value: rules.length },
                { label: "Active", value: rules.filter(rule => rule.active).length },
                { label: "Required", value: rules.filter(rule => rule.required).length },
                { label: "Inactive", value: rules.filter(rule => !rule.active).length },
              ].map(stat => (
                <StatCard key={stat.label} label={stat.label} value={stat.value} className="ff-rules-surface ff-stat-card min-h-0 p-4" />
              ))}
            </div>

            <div className="ff-rules-surface mb-5 flex flex-wrap items-center gap-3 bg-white p-4">
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="w-[190px]"><SelectValue placeholder="Rule stage" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All rule stages</SelectItem>
                  <SelectItem value="start_review">Begin Review</SelectItem>
                  <SelectItem value="approve">Approval</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs font-semibold text-slate-500">{filteredRules.length} matching rules</span>
            </div>

            {/* Info banner */}
            <div className="ff-rules-surface mb-5 flex items-start gap-3 border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/40 dark:bg-blue-950/20">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <div className="text-xs text-blue-700 dark:text-blue-300">
                <span className="font-semibold">How this works: </span>
                Documents required for <strong>Begin Review</strong> must be present before a manager can move an invoice to "Under Review."
                Documents required for <strong>Approval</strong> must be present before the invoice can be approved.
                The lifecycle engine checks these rules automatically and blocks transitions when documents are missing.
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Begin Review group */}
                <RuleGroup
                  title="Required for Begin Review"
                  subtitle="Must be uploaded before manager can start reviewing the invoice"
                  icon={<ClipboardCheck className="h-4 w-4" />}
                  color="blue"
                  rules={reviewRules}
                  isManager={isManager}
                  isAdmin={isAdmin}
                  onEdit={setEditRule}
                  onDelete={setDeleteId}
                  onToggle={(id, field, value) => toggleMut.mutate({ id, field, value })}
                />

                {/* Approval group */}
                <RuleGroup
                  title="Required for Approval"
                  subtitle="Must be uploaded before the invoice can be approved for funding"
                  icon={<Shield className="h-4 w-4" />}
                  color="emerald"
                  rules={approvalRules}
                  isManager={isManager}
                  isAdmin={isAdmin}
                  onEdit={setEditRule}
                  onDelete={setDeleteId}
                  onToggle={(id, field, value) => toggleMut.mutate({ id, field, value })}
                />
              </div>
            )}
          </div>
        </AdminPageShell>
      </div>

      {/* Add dialog */}
      <RuleDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={data => createMut.mutate(data)}
        isSaving={createMut.isPending}
      />

      {/* Edit dialog */}
      <RuleDialog
        open={!!editRule}
        rule={editRule}
        onClose={() => setEditRule(null)}
        onSave={data => editRule && updateMut.mutate({ id: editRule.id, data })}
        isSaving={updateMut.isPending}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent className="ff-rules-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This rule will no longer be checked during invoice lifecycle transitions.
              Existing invoices won't be affected retroactively.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="ff-btn-danger"
              onClick={() => deleteId !== null && deleteMut.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Rule group ───────────────────────────────────────────────────────────────

function RuleGroup({
  title, subtitle, icon, color, rules, isManager, isAdmin, onEdit, onDelete, onToggle,
}: {
  title: string; subtitle: string; icon: React.ReactNode; color: "blue" | "emerald";
  rules: DocumentRule[]; isManager: boolean; isAdmin: boolean;
  onEdit: (r: DocumentRule) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number, field: string, value: boolean) => void;
}) {
  return (
    <Card className="ff-rules-surface overflow-hidden bg-white">
      <div className={cn(
        "flex items-center gap-2 border-b px-5 py-4",
        color === "blue" ? "border-blue-100 bg-blue-50/60 dark:border-blue-900/30 dark:bg-blue-950/10" : "border-emerald-100 bg-emerald-50/60 dark:border-emerald-900/30 dark:bg-emerald-950/10",
      )}>
        <span className={cn("text-sm", color === "blue" ? "text-blue-600 dark:text-blue-400" : "text-emerald-600 dark:text-emerald-400")}>
          {icon}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-white">{title}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <span className="ff-badge ff-badge-draft ml-auto">
          {rules.length}
        </span>
      </div>

      {!rules.length ? (
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-slate-400">
          <AlertTriangle className="h-4 w-4" />
          No rules configured for this stage — any invoice can proceed.
        </div>
      ) : (
        <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
          {rules.map(rule => (
            <div key={rule.id} className={cn(
              "ff-rule-card flex items-start gap-3 px-5 py-4 transition-colors",
              !rule.active && "opacity-50",
            )}>
              <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />

              <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                rule.active ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400" : "bg-slate-100 text-slate-400 dark:bg-slate-800",
              )}>
                {rule.active ? <CheckCircle2 className="h-4 w-4" /> : <FileCheck className="h-4 w-4" />}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-white">{rule.label}</span>
                  <Badge className="ff-badge ff-rules-type">
                    {rule.documentType}
                  </Badge>
                  <StageBadge stage={rule.requiredForStage} />
                  <span className="ff-rules-priority">Priority {rule.sortOrder}</span>
                  {!rule.required && (
                    <Badge className="rounded-full border border-slate-200 bg-white px-2 py-0 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                      Optional
                    </Badge>
                  )}
                  {!rule.active && (
                    <Badge className="ff-badge ff-badge-draft">
                      Inactive
                    </Badge>
                  )}
                  {rule.active && <Badge className="ff-badge ff-badge-funded">Active</Badge>}
                </div>
                {rule.description && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{rule.description}</p>
                )}
              </div>

              {isManager && (
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <Switch
                      checked={rule.active}
                      onCheckedChange={v => onToggle(rule.id, "active", v)}
                      className="data-[state=checked]:bg-emerald-500"
                    />
                    <span className="text-[11px] text-slate-400">Active</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <Switch
                      checked={rule.required}
                      onCheckedChange={v => onToggle(rule.id, "required", v)}
                    />
                    <span className="text-[11px] text-slate-400">Required</span>
                  </label>
                   <Button size="sm" onClick={() => onEdit(rule)}
                    className="ff-rules-edit h-8 w-8 p-0">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {isAdmin && (
                    <Button variant="destructive" size="sm" onClick={() => onDelete(rule.id)}
                      className="ff-rules-delete h-8 w-8 p-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
