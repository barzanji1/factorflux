import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { cn } from "@/lib/utils";

type PaginationContextValue = {
  page: number;
  setPage: (page: number | ((current: number) => number)) => void;
  signature: string;
  rowCount: number;
  registerRows: (signature: string, count: number) => void;
};

const PaginationContext = createContext<PaginationContextValue | null>(null);

export function SafeTablePaginationProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState({ signature: "", count: 0 });
  const registerRows = useCallback((signature: string, count: number) => {
    setRows((current) => current.signature === signature && current.count === count
      ? current
      : { signature, count });
  }, []);
  const value = useMemo(() => ({
    page,
    setPage,
    signature: rows.signature,
    rowCount: rows.count,
    registerRows,
  }), [page, rows, registerRows]);
  return <PaginationContext.Provider value={value}>{children}</PaginationContext.Provider>;
}

function childSignature(children: ReactNode[]) {
  return children.map((child, index) => {
    if (!isValidElement(child)) return `${index}:non-element`;
    const rowKey = child.key ?? (child.props as { "data-row-key"?: string | number })["data-row-key"];
    return rowKey === undefined || rowKey === null ? `${index}:${String(child.type)}` : String(rowKey);
  }).join("|");
}

export function useSafePaginatedRows(children: ReactNode, enabled = true) {
  const context = useContext(PaginationContext);
  const rows = useMemo(() => Children.toArray(children), [children]);
  const signature = childSignature(rows);

  useEffect(() => {
    if (!context || !enabled) return;
    const changed = context.signature !== signature;
    context.registerRows(signature, rows.length);
    if (changed) context.setPage(1);
  }, [context, enabled, rows.length, signature]);

  if (!context || !enabled || rows.length <= DEFAULT_PAGE_SIZE) return rows;
  const page = context.signature === signature ? context.page : 1;
  const start = (page - 1) * DEFAULT_PAGE_SIZE;
  return rows.slice(start, start + DEFAULT_PAGE_SIZE);
}

export function useSafePaginatedTableChildren(children: ReactNode) {
  const tableChildren = Children.toArray(children);
  const bodyIndex = tableChildren.findIndex((child) => isValidElement<{ children?: ReactNode }>(child) && child.type === "tbody");
  const body = bodyIndex >= 0 ? tableChildren[bodyIndex] : null;
  const bodyRows = isValidElement<{ children?: ReactNode }>(body) ? body.props.children : null;
  const visibleRows = useSafePaginatedRows(bodyRows, bodyIndex >= 0);
  return tableChildren.map((child, index) => index === bodyIndex && isValidElement(child)
    ? cloneElement(child, {}, visibleRows)
    : child);
}

export function SafeTablePaginationControls({ className }: { className?: string }) {
  const context = useContext(PaginationContext);
  if (!context || context.rowCount <= DEFAULT_PAGE_SIZE) return null;
  const pages = Math.max(1, Math.ceil(context.rowCount / DEFAULT_PAGE_SIZE));
  const page = context.page;
  const first = (page - 1) * DEFAULT_PAGE_SIZE + 1;
  const last = Math.min(page * DEFAULT_PAGE_SIZE, context.rowCount);
  const buttonClass = "inline-flex min-h-8 items-center justify-center rounded-lg bg-[#e0e5e2] px-3 text-xs font-semibold text-[#405650] shadow-[3px_3px_6px_#c1c9c5,-3px_-3px_6px_#fff] transition-[transform,box-shadow] hover:text-[#187f83] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <nav data-table-pagination aria-label="Table pagination" className={cn("flex flex-wrap items-center justify-between gap-2 px-1 py-3 text-xs text-[#65756f]", className)}>
      <span>Showing {first}–{last} of {context.rowCount.toLocaleString()}</span>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass} disabled={page <= 1} onClick={() => context.setPage((current) => Math.max(1, current - 1))}>Previous</button>
        <span aria-live="polite">Page {page} of {pages}</span>
        <button type="button" className={buttonClass} disabled={page >= pages} onClick={() => context.setPage((current) => Math.min(pages, current + 1))}>Next</button>
      </div>
    </nav>
  );
}

function RawTableContent({ table }: { table: ReactNode }) {
  const tableElement = isValidElement<{ children?: ReactNode }>(table) && table.type === "table" ? table : null;
  const tableChildren = tableElement ? Children.toArray(tableElement.props.children) : [];
  const bodyIndex = tableChildren.findIndex((child) => isValidElement<{ children?: ReactNode }>(child) && child.type === "tbody");
  const body = bodyIndex >= 0 ? tableChildren[bodyIndex] : null;
  const bodyRows = isValidElement<{ children?: ReactNode }>(body) ? body.props.children : null;
  const visibleRows = useSafePaginatedRows(bodyRows);

  if (!tableElement) return <>{table}</>;
  if (!isValidElement<{ children?: ReactNode }>(body)) return <>{table}</>;
  const nextChildren = tableChildren.map((child, index) => index === bodyIndex
    ? cloneElement(body, {}, visibleRows)
    : child);
  return cloneElement(tableElement, {}, nextChildren);
}

export function SafePaginatedTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <SafeTablePaginationProvider>
      <>
        <div className={cn("overflow-x-auto", className)}><RawTableContent table={children} /></div>
        <SafeTablePaginationControls />
      </>
    </SafeTablePaginationProvider>
  );
}
