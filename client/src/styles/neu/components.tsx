import React, {
  createContext,
  forwardRef,
  useContext,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type TableHTMLAttributes,
  type ThHTMLAttributes,
  type TdHTMLAttributes,
  type ReactNode,
  type Ref,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { neuTokenClasses } from "./tokens";
import { SafeTablePaginationControls, SafeTablePaginationProvider, useSafePaginatedRows, useSafePaginatedTableChildren } from "@/components/safe-table-pagination";

export interface NeuCardProps extends HTMLAttributes<HTMLDivElement> {
  pressed?: boolean;
}

export const NeuCard = forwardRef<HTMLDivElement, NeuCardProps>(
  ({ className, pressed = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "ff-institutional-neu-card rounded-2xl bg-[#e0e0e0] text-[#333333]",
        pressed ? neuTokenClasses.concave : neuTokenClasses.convex,
        className,
      )}
      data-ff-neu-pressed={pressed || undefined}
      {...props}
    />
  ),
);
NeuCard.displayName = "NeuCard";

export interface NeuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "accent" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export const NeuButton = forwardRef<HTMLButtonElement, NeuButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", disabled, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[transform,box-shadow,background-color,color] duration-150",
        size === "sm" ? "min-h-8 px-3 py-1.5 text-xs" : size === "lg" ? "min-h-11 px-8 py-2.5 text-base" : size === "icon" ? "h-9 min-h-9 w-9 px-0 py-0" : "min-h-11 px-5 py-2.5 text-sm",
        variant === "accent"
          ? "bg-[#e0e0e0] text-[#168d99] hover:bg-[#e0e0e0] hover:text-[#087f8c]"
          : variant === "destructive"
            ? "bg-[#e0e0e0] text-[#a3483e] hover:text-[#a3483e]"
            : variant === "secondary"
              ? "bg-[#d5d5d5] text-[#444444] hover:text-[#168d99]"
              : variant === "ghost"
                ? "bg-transparent text-[#444444] shadow-none hover:bg-[#d5d5d5] hover:text-[#168d99]"
                : variant === "link"
                  ? "bg-transparent text-[#168d99] shadow-none underline-offset-4 hover:underline"
                  : "bg-[#e0e0e0] text-[#333333] hover:text-[#168d99]",
        variant !== "ghost" && variant !== "link" ? [neuTokenClasses.button, neuTokenClasses.buttonPressed] : "",
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0",
        neuTokenClasses.focus,
        "ff-institutional-neu-button",
        className,
      )}
      data-ff-neu-variant={variant}
      {...props}
    />
  ),
);
NeuButton.displayName = "NeuButton";

export const NeuInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "ff-institutional-neu-field min-h-11 w-full !rounded-xl !border-0 !bg-[#e0e0e0] px-4 py-2.5 text-sm !text-[#333333] placeholder:text-[#888888]",
        neuTokenClasses.input,
        neuTokenClasses.focus,
        className,
      )}
      {...props}
    />
  ),
);
NeuInput.displayName = "NeuInput";

export const NeuTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "ff-institutional-neu-field min-h-24 w-full !rounded-xl !border-0 !bg-[#e0e0e0] px-4 py-3 text-sm !text-[#333333] placeholder:text-[#888888]",
        neuTokenClasses.input,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]",
        className,
      )}
      {...props}
    />
  ),
);
NeuTextarea.displayName = "NeuTextarea";

export interface NeuSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface NeuSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: NeuSelectOption[];
  children?: ReactNode;
}

export const NeuSelect = forwardRef<HTMLSelectElement, NeuSelectProps>(
  ({ className, options, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "ff-institutional-neu-field min-h-11 w-full appearance-auto !rounded-xl !border-0 !bg-[#e0e0e0] px-4 py-2.5 pr-10 text-sm !text-[#333333]",
        neuTokenClasses.input,
        neuTokenClasses.focus,
        className,
      )}
      {...props}
    >
      {options
        ? options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))
        : children}
    </select>
  ),
);
NeuSelect.displayName = "NeuSelect";

interface NeuTabsContextValue {
  selectedValue: string;
  setSelectedValue: (value: string) => void;
  baseId: string;
}

const NeuTabsContext = createContext<NeuTabsContextValue | null>(null);

function useNeuTabs() {
  const context = useContext(NeuTabsContext);
  if (!context) throw new Error("NeuTabs components must be rendered inside NeuTabs.");
  return context;
}

export interface NeuTabsProps extends HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export const NeuTabs = forwardRef<HTMLDivElement, NeuTabsProps>(
  ({ className, value, defaultValue = "", onValueChange, children, ...props }, ref) => {
    const generatedId = useId();
    const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
    const selectedValue = value ?? uncontrolledValue;
    const setSelectedValue = (nextValue: string) => {
      if (value === undefined) setUncontrolledValue(nextValue);
      onValueChange?.(nextValue);
    };
    const context = { selectedValue, setSelectedValue, baseId: `neu-tabs-${generatedId}` };
    return (
      <NeuTabsContext.Provider value={context}>
        <div ref={ref} className={cn("w-full", className)} {...props}>
          {children}
        </div>
      </NeuTabsContext.Provider>
    );
  },
);
NeuTabs.displayName = "NeuTabs";

export const NeuTabList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="tablist"
      className={cn("ff-institutional-neu-tablist flex flex-wrap gap-2 rounded-2xl bg-[#e0e0e0] p-2", neuTokenClasses.flat, className)}
      {...props}
    />
  ),
);
NeuTabList.displayName = "NeuTabList";

export interface NeuTabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export const NeuTab = forwardRef<HTMLButtonElement, NeuTabProps>(
  ({ value, className, onKeyDown, onClick, ...props }, ref) => {
    const { selectedValue, setSelectedValue, baseId } = useNeuTabs();
    const selected = selectedValue === value;
    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      const tabs = Array.from(
        event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [],
      );
      const index = tabs.indexOf(event.currentTarget);
      let nextIndex = index;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      const nextTab = tabs[nextIndex];
      nextTab?.focus();
      nextTab?.click();
    };
    return (
      <button
        ref={ref}
        id={`${baseId}-tab-${value}`}
        type="button"
        role="tab"
        aria-selected={selected}
        aria-controls={`${baseId}-panel-${value}`}
        tabIndex={selected ? 0 : -1}
        className={cn(
          "ff-institutional-neu-tab min-h-10 rounded-xl px-4 py-2 text-sm font-semibold transition-[transform,box-shadow,color] duration-150 focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-[#27aab8]",
          selected
            ? cn("bg-[#e0e0e0] text-[#27aab8]", neuTokenClasses.concave)
            : cn("bg-[#e0e0e0] text-[#333333] hover:text-[#27aab8]", neuTokenClasses.button),
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) setSelectedValue(value);
        }}
        onKeyDown={handleKeyDown}
        {...props}
      />
    );
  },
);
NeuTab.displayName = "NeuTab";

export interface NeuTabPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  unmountInactive?: boolean;
}

export const NeuTabPanel = forwardRef<HTMLDivElement, NeuTabPanelProps>(
  ({ value, className, unmountInactive = false, ...props }, ref) => {
    const { selectedValue, baseId } = useNeuTabs();
    if (unmountInactive && selectedValue !== value) return null;
    return (
      <div
        ref={ref}
        id={`${baseId}-panel-${value}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${value}`}
        tabIndex={0}
        hidden={selectedValue !== value}
        className={cn("ff-institutional-neu-tabpanel mt-5 rounded-2xl bg-[#e0e0e0] p-5 text-[#333333] focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-[#27aab8]", neuTokenClasses.flat, className)}
        {...props}
      />
    );
  },
);
NeuTabPanel.displayName = "NeuTabPanel";

function NeuTableContent({ className, children, tableRef, ...props }: TableHTMLAttributes<HTMLTableElement> & { tableRef: Ref<HTMLTableElement> }) {
  const tableChildren = useSafePaginatedTableChildren(children);
  return (
    <>
      <div className={cn("ff-institutional-neu-table-wrap overflow-x-auto rounded-2xl bg-[#e0e0e0]", neuTokenClasses.flat)}>
        <table ref={tableRef} className={cn("ff-institutional-neu-table w-full border-collapse text-left text-sm text-[#333333]", className)} {...props}>{tableChildren}</table>
      </div>
      <SafeTablePaginationControls />
    </>
  );
}

export const NeuTable = forwardRef<HTMLTableElement, TableHTMLAttributes<HTMLTableElement>>(
  ({ className, children, ...props }, ref) => (
    <SafeTablePaginationProvider>
      <NeuTableContent className={className} tableRef={ref} {...props}>{children}</NeuTableContent>
    </SafeTablePaginationProvider>
  ),
);
NeuTable.displayName = "NeuTable";

export const NeuTableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("ff-institutional-neu-table-head bg-[#d7d7d7] text-[#555555]", className)} {...props} />
  ),
);
NeuTableHeader.displayName = "NeuTableHeader";

export const NeuTableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, children, ...props }, ref) => {
    const visibleRows = useSafePaginatedRows(children);
    return <tbody ref={ref} className={cn("ff-institutional-neu-table-body divide-y divide-[#c9c9c9]", className)} {...props}>{visibleRows}</tbody>;
  },
);
NeuTableBody.displayName = "NeuTableBody";

export const NeuTableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn("ff-institutional-neu-table-row transition-colors hover:bg-[#d9e8e8]", className)} {...props} />
  ),
);
NeuTableRow.displayName = "NeuTableRow";

export const NeuTableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th ref={ref} scope="col" className={cn("ff-institutional-neu-table-cell whitespace-nowrap px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[#777777]", className)} {...props} />
  ),
);
NeuTableHead.displayName = "NeuTableHead";

export const NeuTableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("ff-institutional-neu-table-cell whitespace-nowrap px-5 py-4", className)} {...props} />
  ),
);
NeuTableCell.displayName = "NeuTableCell";

export interface NeuBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "accent" | "success" | "warning";
}

export const NeuBadge = forwardRef<HTMLSpanElement, NeuBadgeProps>(
  ({ className, tone = "neutral", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full bg-[#e0e0e0] px-3 py-1 text-xs font-semibold",
        "ff-institutional-neu-badge",
        neuTokenClasses.flat,
        tone === "accent" && "text-[#27aab8]",
        tone === "success" && "text-[#347d69]",
        tone === "warning" && "text-[#9b6a22]",
        tone === "neutral" && "text-[#666666]",
        className,
      )}
      data-ff-neu-tone={tone}
      {...props}
    />
  ),
);
NeuBadge.displayName = "NeuBadge";

export interface NeuStatCardProps extends Omit<NeuCardProps, "children"> {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
}

export const NeuStatCard = forwardRef<HTMLDivElement, NeuStatCardProps>(
  ({ label, value, detail, icon, className, ...props }, ref) => (
    <NeuCard ref={ref} className={cn("flex min-h-40 flex-col justify-between p-5", className)} {...props}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.13em] text-[#888888]">{label}</p>
        {icon && <span className="text-[#27aab8]">{icon}</span>}
      </div>
      <div>
        <p className="mt-5 text-3xl font-semibold tracking-tight text-[#333333]">{value}</p>
        {detail && <p className="mt-1 text-sm text-[#888888]">{detail}</p>}
      </div>
    </NeuCard>
  ),
);
NeuStatCard.displayName = "NeuStatCard";

export const NeuPageShell = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <main
      ref={ref}
      className={cn("relative min-h-[100dvh] overflow-y-auto bg-[#e0e0e0] text-[#333333]", className)}
      {...props}
    />
  ),
);
NeuPageShell.displayName = "NeuPageShell";
