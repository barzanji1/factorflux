import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface OnboardingStep {
  label: string;
  detail?: string;
  done?: boolean;
}

interface FFOnboardingProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  steps?: OnboardingStep[];
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  hint?: string;
  className?: string;
}

export function FFOnboarding({
  title,
  description,
  icon: Icon,
  steps = [],
  primaryAction,
  secondaryAction,
  hint,
  className,
}: FFOnboardingProps) {
  return (
    <div className={cn(
      "rounded-[16px] border border-dashed border-slate-200 bg-slate-50/50 px-8 py-10 text-center dark:border-slate-700/60 dark:bg-slate-900/20",
      className
    )}>
      {Icon && (
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[16px] bg-white shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-800 dark:ring-slate-700/60">
          <Icon className="h-6 w-6 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
        </div>
      )}

      <p className="text-[15px] font-semibold text-slate-800 dark:text-slate-200">{title}</p>
      <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400 max-w-[280px] mx-auto leading-relaxed">
        {description}
      </p>

      {steps.length > 0 && (
        <div className="mt-6 space-y-2.5 text-left max-w-[280px] mx-auto">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              {step.done
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />}
              <div>
                <p className={cn(
                  "text-[12.5px] font-medium leading-snug",
                  step.done ? "text-slate-400 line-through dark:text-slate-600" : "text-slate-700 dark:text-slate-300"
                )}>
                  {step.label}
                </p>
                {step.detail && !step.done && (
                  <p className="text-[11.5px] text-slate-400 dark:text-slate-500 mt-0.5">{step.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hint && (
        <p className="mt-5 text-[11.5px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/60 rounded-lg px-3 py-2 mx-auto max-w-[280px]">
          {hint}
        </p>
      )}

      {(primaryAction || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-blue-600 px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-blue-700"
            >
              {primaryAction.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="inline-flex items-center rounded-[9px] border border-slate-200 bg-white px-4 py-2 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
