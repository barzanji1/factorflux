import "./loading.css";

export function SectionLoading({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label={label} aria-busy="true" data-section-loading>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-4 py-2" aria-hidden="true">
          <span className="ff-loading-placeholder ff-loading-placeholder--short" />
          <span className="ff-loading-placeholder ff-loading-placeholder--full" />
        </div>
      ))}
    </div>
  );
}
