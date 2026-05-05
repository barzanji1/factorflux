import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── FFModuleHeader ───────────────────────────────────────────────────────────
//
//  One consistent header pattern for every module section in FactorFlux.
//  Renders title, optional description, optional count pill, and an actions slot.
//
//  Usage:
//    <FFModuleHeader
//      title="Pending Review"
//      description="Loads awaiting document verification"
//      count={12}
//      countLabel="loads"
//      actions={<Button size="sm">New Load</Button>}
//    />

interface FFModuleHeaderProps {
  title: string;
  description?: string;
  count?: number;
  countLabel?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
  divider?: boolean;
  className?: string;
}

export function FFModuleHeader({
  title,
  description,
  count,
  countLabel = "items",
  actions,
  icon: Icon,
  divider = false,
  className,
}: FFModuleHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4",
        divider &&
          "border-b border-slate-100 pb-4 dark:border-slate-800",
        className
      )}
    >
      {/* Left: icon + text */}
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-slate-100 dark:bg-slate-800/60">
            <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" strokeWidth={1.75} />
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="truncate text-[14.5px] font-semibold tracking-tight text-slate-900 dark:text-white">
              {title}
            </h2>

            {count !== undefined && (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {count.toLocaleString()} {countLabel}
              </span>
            )}
          </div>

          {description && (
            <p className="mt-0.5 text-[12.5px] text-slate-400 dark:text-slate-500">
              {description}
            </p>
          )}
        </div>
      </div>

      {/* Right: actions */}
      {actions && (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
