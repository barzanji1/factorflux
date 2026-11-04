import { DEFAULT_PAGE_SIZE } from "@shared/pagination";

export function ServerArrayPagination({
  page, pageCount, pageSize = DEFAULT_PAGE_SIZE, total, onPageChange, disabled = false,
}: {
  page: number; pageCount: number; pageSize?: number; total: number;
  onPageChange: (page: number) => void; disabled?: boolean;
}) {
  if (total <= pageSize) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const buttonClass = "inline-flex min-h-9 items-center justify-center rounded-xl px-3 text-xs font-semibold text-[#405650] transition-colors hover:text-[#187f83] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#238b87] disabled:cursor-not-allowed disabled:opacity-45";
  return (
    <nav data-table-pagination aria-label="History pagination" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-[#64736d]">
      <span>Showing {first}–{last} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass} disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
        <span aria-live="polite">Page {page} of {pageCount}</span>
        <button type="button" className={buttonClass} disabled={disabled || page >= pageCount} onClick={() => onPageChange(page + 1)}>Next</button>
      </div>
    </nav>
  );
}
