import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { NeuBadge } from "@/styles/neu";
import {
  LOAD_TYPES,
  LOAD_TYPE_LABELS,
  displayLoadType,
  type LoadType,
} from "@shared/load-types";

const LOAD_TYPE_STYLES: Record<LoadType, { badge: string; selected: string; idle: string }> = {
  otr_load: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    selected: "border-emerald-600 bg-emerald-600 text-white shadow-sm",
    idle: "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-slate-900 dark:text-emerald-300",
  },
  dump_truck_ticket: {
    badge: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300",
    selected: "border-orange-600 bg-orange-600 text-white shadow-sm",
    idle: "border-orange-200 bg-white text-orange-700 hover:bg-orange-50 dark:border-orange-900/60 dark:bg-slate-900 dark:text-orange-300",
  },
  hotshot: {
    badge: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300",
    selected: "border-blue-600 bg-blue-600 text-white shadow-sm",
    idle: "border-blue-200 bg-white text-blue-700 hover:bg-blue-50 dark:border-blue-900/60 dark:bg-slate-900 dark:text-blue-300",
  },
  other: {
    badge: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
    selected: "border-slate-600 bg-slate-600 text-white shadow-sm",
    idle: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
};

export function LoadTypeBadge({ value, neuStyle = false }: { value?: string | null; neuStyle?: boolean }) {
  const type = displayLoadType(value);
  if (neuStyle) {
    const tone = type === "otr_load" ? "success" : type === "hotshot" ? "accent" : "neutral";
    return <NeuBadge tone={tone} className="px-2.5 py-1 text-xs">{LOAD_TYPE_LABELS[type]}</NeuBadge>;
  }
  return (
    <Badge className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", LOAD_TYPE_STYLES[type].badge)}>
      {LOAD_TYPE_LABELS[type]}
    </Badge>
  );
}

export function LoadTypeToggleGroup({
  value,
  onChange,
  disabled,
  neuStyle = false,
}: {
  value?: string | null;
  onChange: (value: LoadType) => void;
  disabled?: boolean;
  neuStyle?: boolean;
}) {
  const selected = displayLoadType(value);
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Load type">
      {LOAD_TYPES.map((type) => {
        const active = selected === type;
        return (
          <button
            key={type}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(type)}
            className={cn(
              neuStyle
                ? cn(
                    "min-h-10 rounded-xl border-0 px-4 py-2 text-sm font-semibold transition-[transform,box-shadow,color] duration-150 disabled:cursor-not-allowed disabled:opacity-60",
                    active
                      ? "bg-[#e0e0e0] text-[#168894] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]"
                      : "bg-[#e0e0e0] text-[#555] shadow-[-4px_-4px_9px_#ffffff,4px_4px_9px_#c1c1c1] hover:text-[#168894]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]",
                  )
                : cn(
                    "rounded-full border px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-70",
                    active ? LOAD_TYPE_STYLES[type].selected : LOAD_TYPE_STYLES[type].idle,
                  ),
            )}
          >
            {LOAD_TYPE_LABELS[type]}
          </button>
        );
      })}
    </div>
  );
}