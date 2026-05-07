import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FileText, Truck, Archive, ListTodo, TrendingUp,
  RotateCcw, ShieldCheck, Activity,
  InboxIcon, SearchX, ArrowRight,
} from "lucide-react";

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
  hint?: string;
};

const PRESETS: Record<FFEmptyContext, Preset> = {
  loads: {
    icon: FileText,
    title: "No loads on record",
    detail: "Once carriers submit loads they'll appear here for review and funding.",
    hint: "Start by uploading a Bill of Lading or Rate Confirmation.",
  },
  accounts: {
    icon: Truck,
    title: "No accounts yet",
    detail: "Add a carrier or broker to get started with factoring.",
    hint: "Every funded load needs a linked carrier account.",
  },
  documents: {
    icon: Archive,
    title: "No documents filed",
    detail: "Upload freight paperwork to attach it to a load.",
    hint: "Accepted: BOL, Rate Con, POD, Invoice — PDF or image.",
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
    hint: "New submissions will appear here automatically.",
  },
  payouts: {
    icon: TrendingUp,
    title: "No payouts yet",
    detail: "Advance disbursements will appear here once loads are funded.",
    hint: "Approve a load in the Funding Queue to trigger a payout.",
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

interface FFEmptyAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

interface FFEmptyProps {
  context?: FFEmptyContext;
  icon?: LucideIcon;
  title?: string;
  detail?: string;
  hint?: string;
  action?: FFEmptyAction;
  actions?: FFEmptyAction[];
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function FFEmpty({
  context = "generic",
  icon,
  title,
  detail,
  hint,
  action,
  actions,
  size = "md",
  className,
}: FFEmptyProps) {
  const preset = PRESETS[context];

  const Icon = icon ?? preset.icon;
  const resolvedTitle  = title  ?? preset.title;
  const resolvedDetail = detail ?? preset.detail;
  const resolvedHint   = hint   ?? preset.hint;

  const sizeMap = {
    sm: {
      wrap: "py-10 px-4",
      icon: "h-10 w-10 rounded-xl",
      iconInner: "h-4 w-4",
      title: "text-[13px]",
      detail: "text-[12px]",
      hint: "text-[11px]",
    },
    md: {
      wrap: "py-14 px-6",
      icon: "h-12 w-12 rounded-[14px]",
      iconInner: "h-5 w-5",
      title: "text-[14px]",
      detail: "text-[13px]",
      hint: "text-[11.5px]",
    },
    lg: {
      wrap: "py-20 px-8",
      icon: "h-16 w-16 rounded-[18px]",
      iconInner: "h-7 w-7",
      title: "text-[15px]",
      detail: "text-[13.5px]",
      hint: "text-[12px]",
    },
  };

  const s = sizeMap[size];

  const allActions: FFEmptyAction[] = actions ?? (action ? [action] : []);

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

      <p className={cn("font-semibold text-slate-700 dark:text-slate-300", s.title)}>
        {resolvedTitle}
      </p>

      <p className={cn("mt-1 max-w-[260px] text-slate-400 dark:text-slate-500", s.detail)}>
        {resolvedDetail}
      </p>

      {resolvedHint && (
        <p className={cn(
          "mt-2 max-w-[240px] rounded-lg bg-slate-50 px-3 py-1.5 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400",
          s.hint
        )}>
          {resolvedHint}
        </p>
      )}

      {allActions.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {allActions.map((a, i) =>
            a.primary ? (
              <button
                key={i}
                type="button"
                onClick={a.onClick}
                className="inline-flex items-center gap-1.5 rounded-[9px] bg-blue-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-blue-700"
              >
                {a.label}
                <ArrowRight className="h-3 w-3" />
              </button>
            ) : (
              <button
                key={i}
                type="button"
                onClick={a.onClick}
                className="inline-flex items-center justify-center rounded-[9px] border border-slate-200 bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {a.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

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
