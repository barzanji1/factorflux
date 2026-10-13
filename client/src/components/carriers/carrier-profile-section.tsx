import type { ReactNode } from "react";
import { CompressionInfo } from "@/components/documents/compression-info";
import { FileText, Plus, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ProfileSection({ title, eyebrow, action, children, className }: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border border-[#b7c2c7] bg-white shadow-[1px_1px_0_#7b8589]", className)}>
      <div className="flex items-center justify-between border-b border-[#c7d0d3] bg-[#e7edef] px-3 py-2">
        <div>
          {eyebrow && <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#5d7279]">{eyebrow}</p>}
          <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#223c47]">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function ProfileField({ label, value, tone }: { label: string; value?: ReactNode; tone?: "danger" | "accent" }) {
  const present = value !== undefined && value !== null && String(value).trim() !== "";
  return (
    <div className="min-w-0 border-b border-dotted border-[#d4dcde] py-1.5 last:border-b-0">
      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#718187]">{label}</p>
      <p className={cn("truncate text-[12px] font-semibold", present ? "text-[#263b44]" : "text-[#9aa7ab]", tone === "danger" && present && "text-[#a33131]", tone === "accent" && present && "text-[#087d8d]")}>
        {present ? value : "Not recorded"}
      </p>
    </div>
  );
}

export function EmptyState({ label = "No records on file", actionLabel, onAction }: { label?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="flex min-h-16 items-center justify-between border border-dashed border-[#c9d2d5] bg-[#f8faf9] px-3 py-3">
      <p className="text-[11px] text-[#7b8a8f]">{label}</p>
      {actionLabel && onAction && <Button type="button" variant="outline" size="sm" onClick={onAction} className="h-7 gap-1 rounded-sm border-[#9caeb3] px-2 text-[10px]"><Plus className="h-3 w-3" />{actionLabel}</Button>}
    </div>
  );
}

export function DocumentList({ title, docs, categories, onUpload, onDownload }: {
  title?: string;
  docs: any[];
  categories: string[];
  onUpload?: (category: string, file: File) => void;
  onDownload?: (doc: any) => void;
}) {
  return (
    <div className="space-y-2">
      {title && <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#5d7279]">{title}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {categories.map((category) => {
          const matches = docs.filter((doc) => (doc.documentCategory || doc.documentType || "").toLowerCase() === category.toLowerCase());
          return (
            <div key={category} className="border border-[#d0d9dc] bg-[#fbfcfb] p-2">
              <div className="flex items-center gap-2">
                <FileText className={cn("h-4 w-4 shrink-0", matches.length ? "text-[#078393]" : "text-[#a7b2b5]")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-[#30474f]">{category}</p>
                  <p className="text-[9px] text-[#809096]">{matches.length ? `${matches.length} on file` : "Not recorded"}</p>
                </div>
                {onUpload && (
                  <label className="cursor-pointer text-[#087d8d] hover:text-[#075e6a]" title={`Upload another ${category}`}>
                    <UploadCloud className="h-4 w-4" />
                    <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic,.heif" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(category, file); event.currentTarget.value = ""; }} />
                  </label>
                )}
              </div>
              {matches.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-[#e1e6e7] pt-1">
                  {matches.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[9px] text-[#667a80]">{doc.originalName || doc.filename}</span>
                      <CompressionInfo originalSize={doc.originalSize} compressedSize={doc.compressedSize} />
                      {onDownload && <Button type="button" variant="ghost" size="sm" onClick={() => onDownload(doc)} className="h-6 shrink-0 px-1.5 text-[10px] text-[#087d8d]">Download</Button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}