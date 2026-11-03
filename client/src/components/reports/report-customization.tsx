import { useEffect, useMemo, useState } from "react";
import { Columns3, Save, Trash2 } from "lucide-react";
import { NeuButton, NeuInput } from "@/styles/neu/components";
import { useToast } from "@/hooks/use-toast";

export type ReportColumn = { key: string; label: string; defaultVisible?: boolean };
type SavedTemplate = { id: string; name: string; visible: string[]; filters: Record<string, string> };
type Stored = { version: 1; visible: string[]; templates: SavedTemplate[] };
const MAX_TEMPLATES = 10;
const validStored = (value: unknown): value is Stored => {
  if (!value || typeof value !== "object") return false;
  const item = value as Stored;
  return item.version === 1 && Array.isArray(item.visible) && item.visible.every(v => typeof v === "string")
    && Array.isArray(item.templates) && item.templates.length <= MAX_TEMPLATES
    && item.templates.every(t => t && typeof t.id === "string" && typeof t.name === "string" && Array.isArray(t.visible) && t.visible.every(v => typeof v === "string") && !!t.filters && typeof t.filters === "object");
};
const readStored = (key: string): Stored => {
  try { const raw = localStorage.getItem(key); if (!raw) return { version: 1, visible: [], templates: [] }; const parsed: unknown = JSON.parse(raw); return validStored(parsed) ? parsed : { version: 1, visible: [], templates: [] }; }
  catch { return { version: 1, visible: [], templates: [] }; }
};

export function useReportColumns(reportId: string, userId: string | undefined, columns: ReportColumn[], filters: Record<string, string>) {
  const { toast } = useToast();
  const key = `report-preferences:v1:${userId || "anonymous"}:${reportId}`;
  const schema = columns.map(column => `${column.key}:${column.label}:${column.defaultVisible !== false}`).join("|");
  const stableColumns = useMemo(() => columns, [schema]);
  const defaults = useMemo(() => stableColumns.filter(c => c.defaultVisible !== false).map(c => c.key), [stableColumns]);
  const [visible, setVisibleState] = useState<string[]>(defaults);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  useEffect(() => {
    const stored = readStored(key);
    const known = new Set(stableColumns.map(c => c.key));
    const next = stableColumns.filter(c => stored.visible.includes(c.key)).map(c => c.key);
    setVisibleState(next.length ? next : defaults);
    setTemplates(stored.templates.map(t => ({ ...t, visible: t.visible.filter(k => known.has(k)) })).filter(t => t.visible.length));
  }, [key, defaults, schema]);
  const persist = (nextVisible: string[], nextTemplates = templates) => {
    try { localStorage.setItem(key, JSON.stringify({ version: 1, visible: nextVisible, templates: nextTemplates.slice(0, MAX_TEMPLATES) } satisfies Stored)); }
    catch { toast({ title: "Report preferences were not saved", description: "Browser storage is unavailable. Your changes apply only to this session.", variant: "destructive" }); }
  };
  const setVisible = (next: string[]) => {
    const valid = stableColumns.filter(c => next.includes(c.key)).map(c => c.key);
    if (!valid.length) return;
    setVisibleState(valid); persist(valid);
  };
  const saveTemplate = (name: string) => {
    if (!name.trim() || templates.length >= MAX_TEMPLATES) return;
    const next = [...templates, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: name.trim(), visible, filters: { ...filters } }].slice(-MAX_TEMPLATES);
    setTemplates(next); persist(visible, next);
  };
  const applyTemplate = (template: SavedTemplate) => {
    const keys = template.visible.filter(k => stableColumns.some(c => c.key === k));
    setVisible(keys.length ? keys : defaults); return template.filters;
  };
  const deleteTemplate = (id: string) => {
    const next = templates.filter(t => t.id !== id); setTemplates(next); persist(visible, next);
  };
  return { visible, setVisible, templates, saveTemplate, applyTemplate, deleteTemplate };
}

export function CustomizeColumns({ columns, visible, onChange, templates, onSave, onApply, onDelete }: {
  columns: ReportColumn[]; visible: string[]; onChange: (keys: string[]) => void;
  templates: SavedTemplate[]; onSave: (name: string) => void; onApply: (template: SavedTemplate) => void; onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const activeTemplate = templates.find(t => t.id === templateId);
  return <div className="recovery-neu-customization relative">
    <NeuButton aria-expanded={open} className="min-h-9 rounded-lg px-3 text-xs" onClick={() => setOpen(v => !v)}><Columns3 className="h-4 w-4" />Customize columns</NeuButton>
    {open && <div className="absolute right-0 z-40 mt-2 w-[min(340px,calc(100vw-2rem))] rounded-xl bg-[#e0e0e0] p-3 shadow-[6px_6px_16px_#aaa,-5px_-5px_14px_#fff]">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#707070]">Visible columns</p>
      <div className="max-h-52 space-y-1 overflow-y-auto">{columns.map(column => <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[#d4e8e8]">
        <input type="checkbox" checked={visible.includes(column.key)} disabled={visible.length === 1 && visible.includes(column.key)} onChange={() => onChange(visible.includes(column.key) ? visible.filter(key => key !== column.key) : [...visible, column.key])} className="accent-[#168f9b]" />{column.label}
      </label>)}</div>
      <div className="mt-3 border-t border-[#c1c1c1] pt-3">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#707070]">Saved templates · {templates.length}/{MAX_TEMPLATES}</p>
        <div className="flex gap-1"><select aria-label="Saved report templates" value={templateId} onChange={e => setTemplateId(e.target.value)} className="min-w-0 flex-1 rounded-md bg-[#e0e0e0] px-2 py-1.5 text-xs shadow-[inset_2px_2px_4px_#c1c1c1,inset_-2px_-2px_4px_#fff]"><option value="">Choose template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><NeuButton aria-label="Delete selected template" className="min-h-8 rounded-md px-2" disabled={!activeTemplate} onClick={() => { if (activeTemplate) { onDelete(activeTemplate.id); setTemplateId(""); } }}><Trash2 className="h-3.5 w-3.5" /></NeuButton></div>
        <div className="mt-2 flex gap-1"><NeuButton className="min-h-8 rounded-md px-2 text-xs" disabled={!activeTemplate} onClick={() => activeTemplate && onApply(activeTemplate)}>Apply</NeuButton><NeuInput aria-label="Template name" className="min-h-8 rounded-md px-2 py-1 text-xs" placeholder="Name this view" maxLength={40} value={name} onChange={e => setName(e.target.value)} /><NeuButton aria-label="Save template" variant="accent" className="min-h-8 rounded-md px-2" disabled={!name.trim() || templates.length >= MAX_TEMPLATES} onClick={() => { onSave(name.trim()); setName(""); }}><Save className="h-3.5 w-3.5" /></NeuButton></div>
        {templates.length >= MAX_TEMPLATES && <p className="mt-1 text-[10px] text-[#777]">Delete a template before saving another.</p>}
      </div>
    </div>}
  </div>;
}

export type { SavedTemplate };
