import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Save } from "lucide-react";
import type { EmailTemplate } from "../../../../shared/email-templates";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NeuButton as Button, NeuInput as Input, NeuTextarea as Textarea } from "@/styles/neu";

const templatesKey = ["/api/client-email/templates"];

async function loadTemplates(): Promise<EmailTemplate[]> {
  const response = await fetch("/api/client-email/templates", { credentials: "include" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Templates could not be loaded (HTTP ${response.status}).`);
  if (!Array.isArray(result)) throw new Error("Template list response was invalid.");
  return result as EmailTemplate[];
}

export function EmailTemplatePicker({
  value,
  onChange,
  disabled = false,
  id,
}: {
  value: string;
  onChange: (template: EmailTemplate | null) => void;
  disabled?: boolean;
  id: string;
}) {
  const queryClient = useQueryClient();
  const templatesQuery = useQuery({ queryKey: templatesKey, queryFn: loadTemplates });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/client-email/templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), subject: subject.trim(), body: body.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `Template could not be saved (HTTP ${response.status}).`);
      return result as EmailTemplate;
    },
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: templatesKey });
      onChange(template);
      setDialogOpen(false);
      setName("");
      setSubject("");
      setBody("");
    },
  });
  const selected = templatesQuery.data?.find((template) => template.id === value);

  return <div className="space-y-1.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label htmlFor={id}>Optional shared template</Label>
      <Button type="button" className="min-h-8 px-3 text-[10px]" disabled={disabled} onClick={() => setDialogOpen(true)}>
        <Plus className="mr-1 h-3 w-3" />Add custom template
      </Button>
    </div>
    {templatesQuery.isLoading
        ? <div className="h-10 animate-pulse rounded-xl bg-[#e0e0e0] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]" aria-label="Loading email templates" />
      : templatesQuery.error
        ? <div role="alert" className="flex items-center justify-between gap-2 rounded-xl bg-[#e0e0e0] p-2 text-[10px] text-[#8d433a] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]"><span>{(templatesQuery.error as Error).message}</span><Button type="button" className="min-h-8 px-3 text-[10px]" onClick={() => void templatesQuery.refetch()}>Retry</Button></div>
        : <select id={id} value={value || "none"} disabled={disabled}
            onChange={(event) => onChange(event.target.value === "none" ? null : templatesQuery.data?.find((template) => template.id === event.target.value) || null)}
            className="h-11 w-full rounded-xl border-0 bg-[#e0e0e0] px-4 text-xs text-[#344244] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff] focus:outline-none focus:ring-2 focus:ring-[#27aab8] disabled:opacity-50">
          <option value="none">No template</option>
          {(templatesQuery.data || []).map((template) => <option key={template.id} value={template.id}>{template.name}{template.kind === "custom" ? " · Shared" : ""}</option>)}
        </select>}
    {templatesQuery.isFetching && !templatesQuery.isLoading && <p className="flex items-center gap-1 text-[9px] text-[#758582]"><RefreshCw className="h-3 w-3 animate-spin" />Refreshing shared templates</p>}
    {selected && <p className="text-[10px] text-[#657977]">{selected.kind === "custom" ? "Shared custom template" : "Built-in template"} · starting text remains editable.</p>}

    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saveMutation.isPending) setDialogOpen(open); }}>
      <DialogContent className="email-neu-dialog max-h-[92dvh] max-w-lg overflow-y-auto p-0">
        <DialogHeader className="border-b border-[#b8c3bf] bg-[#d6e2de] px-4 py-3 text-left">
          <DialogTitle className="text-sm font-bold text-[#203a46]">Add shared custom template</DialogTitle>
          <DialogDescription className="text-[10px] text-[#596d70]">Save reusable starting text for both client email composers. Your current draft is unchanged until you select the saved template.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <div className="space-y-1"><Label htmlFor={`${id}-template-name`}>Template name</Label><Input id={`${id}-template-name`} value={name} maxLength={100} disabled={saveMutation.isPending} onChange={(event) => setName(event.target.value)} className="text-xs" placeholder="For example, Holiday closure notice" /><p className="text-right text-[9px] text-[#84918f]">{name.length}/100</p></div>
          <div className="space-y-1"><Label htmlFor={`${id}-template-subject`}>Subject</Label><Input id={`${id}-template-subject`} value={subject} maxLength={200} disabled={saveMutation.isPending} onChange={(event) => setSubject(event.target.value)} className="text-xs" placeholder="A clear, specific subject" /></div>
          <div className="space-y-1"><Label htmlFor={`${id}-template-body`}>Message</Label><Textarea id={`${id}-template-body`} value={body} maxLength={20000} rows={7} disabled={saveMutation.isPending} onChange={(event) => setBody(event.target.value)} className="resize-y text-xs leading-relaxed" placeholder="Write reusable message text…" /></div>
          {saveMutation.error && <div role="alert" className="border border-[#d3a49e] bg-[#fff1ee] p-2.5 text-[10px] leading-relaxed text-[#8d433a]"><strong>Template not saved.</strong> {(saveMutation.error as Error).message} Your composer draft is retained. You can retry.</div>}
          {saveMutation.isSuccess && <p role="status" className="text-[10px] text-[#28644f]">Template saved and selected.</p>}
        </div>
        <DialogFooter className="flex flex-wrap justify-end gap-2 border-t border-[#c5cfcc] bg-[#e1e8e5] px-4 py-3">
          <Button type="button" className="min-h-9 px-4 text-xs" disabled={saveMutation.isPending} onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button type="button" variant="accent" className="min-h-9 px-4 text-xs" disabled={saveMutation.isPending || !name.trim() || !subject.trim() || !body.trim()} onClick={() => saveMutation.mutate()}>
            <Save className="mr-1.5 h-3.5 w-3.5" />{saveMutation.isPending ? "Saving…" : "Save shared template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
