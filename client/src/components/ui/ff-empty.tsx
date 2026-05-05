import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FileText, Truck, Archive, ListTodo, TrendingUp,
  RotateCcw, ShieldCheck, Activity, Building2,
  InboxIcon, SearchX,
} from "lucide-react";

// ─── Preset context strings ───────────────────────────────────────────────────
//
//  Pass `context` for a ready-made empty state scoped to that module.
//  Override any field with explicit props.

export type FFEmptyContext =
  | "loads"
  | "accounts"
  | "documents"
  | "tasks"
  | "funding"
  | "payouts"
  | "collections"
  | "exceptions"
  | "audit"
  | "search"
  | "generic";

type Preset = {
  icon: LucideIcon;
  title: string;
  detail: string;
};

const PRESETS: Record<FFEmptyContext, Preset> = {
  loads: {
    icon: FileText,
    title: "No loads on record",
    detail: "Once carriers submit loads they'll appear here for review and funding.",
  },
  accounts: {
    icon: Truck,
    title: "No accounts yet",
    detail: "Add a carrier or broker to get started with factoring.",
  },
  documents: {
    icon: Archive,
    title: "No documents filed",
    detail: "Upload freight paperwork to attach it to a load.",
  },
  tasks: {
    icon: ListTodo,
    title: "All caught up",
    detail: "No open tasks — create one to track follow-ups and callbacks.",
  },
  funding: {
    icon: TrendingUp,
    title: "Funding queue is clear",
    detail: "No loads are currently awaiting approval or disbursement.",
  },
  payouts: {
    icon: TrendingUp,
    title: "No payouts yet",
    detail: "Advance disbursements will appear here once loads are funded.",
  },
  collections: {
    icon: RotateCcw,
    title: "Nothing in recovery",
    detail: "All outstanding balances are resolved — no active collection items.",
  },
  exceptions: {
    icon: ShieldCheck,
    title: "No exceptions",
    detail: "This load has no flagged items, short-pays, or unresolved holds.",
  },
  audit: {
    icon: Activity,
    title: "No activity yet",
    detail: "Events will be recorded here as changes are made.",
  },
  search: {
    icon: SearchX,
    title: "No results found",
    detail: "Try adjusting your search terms or filters.",
  },
  generic: {
    icon: InboxIcon,
    title: "Nothing here yet",
    detail: "Data will appear here once activity begins.",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface FFEmptyProps {
  context?: FFEmptyContext;
  icon?: LucideIcon;
  title?: string;
  detail?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function FFEmpty({
  context = "generic",
  icon,
  title,
  detail,
  action,
  size = "md",
  className,
}: FFEmptyProps) {
  const preset = PRESETS[context];

  const Icon = icon ?? preset.icon;
  const resolvedTitle  = title  ?? preset.title;
  const resolvedDetail = detail ?? preset.detail;

  const sizeMap = {
    sm: { wrap: "py-10 px-4", icon: "h-10 w-10 rounded-xl", iconInner: "h-4 w-4", title: "text-[13px]", detail: "text-[12px]" },
    md: { wrap: "py-14 px-6", icon: "h-12 w-12 rounded-[14px]", iconInner: "h-5 w-5", title: "text-[14px]", detail: "text-[13px]" },
    lg: { wrap: "py-20 px-8", icon: "h-16 w-16 rounded-[18px]", iconInner: "h-7 w-7", title: "text-[15px]", detail: "text-[13.5px]" },
  };

  const s = sizeMap[size];

  return (
    <div className={cn("flex flex-col items-center text-center", s.wrap, className)}>
      <div
        className={cn(
          "mb-3.5 flex items-center justify-center bg-slate-100 dark:bg-slate-800/60",
          s.icon
        )}
      >
        <Icon
          className={cn("text-slate-400 dark:text-slate-500", s.iconInner)}
          strokeWidth={1.5}
        />
      </div>

      <p
        className={cn(
          "font-semibold text-slate-700 dark:text-slate-300",
          s.title
        )}
      >
        {resolvedTitle}
      </p>

      <p
        className={cn(
          "mt-1 max-w-[260px] text-slate-400 dark:text-slate-500",
          s.detail
        )}
      >
        {resolvedDetail}
      </p>

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 inline-flex items-center justify-center rounded-[9px] border border-slate-200 bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ─── Legacy export alias ─────────────────────────────────────────────────────

interface LegacyEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: LegacyEmptyStateProps) {
  return (
    <FFEmpty
      icon={icon}
      title={title}
      detail={description}
      action={action}
      className={className}
    />
  );
}
