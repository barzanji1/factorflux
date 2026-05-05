import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { Plus, Truck, BarChart3, Archive, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

type Action = {
  title: string;
  description: string;
  icon: LucideIcon;
  tint: string;
  bg: string;
  href: string;
};

const actions: Action[] = [
  {
    title: "New Load Entry",
    description: "Create and issue a load invoice",
    icon: Plus,
    tint: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    href: "/invoices",
  },
  {
    title: "Register Carrier",
    description: "Onboard a new carrier account",
    icon: Truck,
    tint: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    href: "/clients",
  },
  {
    title: "Open Insights",
    description: "View funding and portfolio reports",
    icon: BarChart3,
    tint: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    href: "/reports",
  },
  {
    title: "Upload Evidence",
    description: "Add freight and compliance files",
    icon: Archive,
    tint: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/30",
    href: "/documents",
  },
];

export default function QuickActions() {
  const [, setLocation] = useLocation();

  return (
    <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <CardHeader className="border-b border-slate-100 pb-3 dark:border-slate-800">
        <CardTitle className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
          Quick Launch
        </CardTitle>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Common workflows in one click
        </p>
      </CardHeader>

      <CardContent className="p-4">
        <div className="space-y-2">
          {actions.map(action => {
            const Icon = action.icon;
            return (
              <button
                key={action.title}
                type="button"
                onClick={() => setLocation(action.href)}
                className={cn(
                  "group flex w-full items-center justify-between rounded-[14px] border border-slate-200/80 bg-slate-50/50 p-3.5 text-left transition-all duration-150",
                  "hover:border-slate-200 hover:bg-slate-50 hover:shadow-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                  "dark:border-slate-800 dark:bg-slate-900/30 dark:hover:border-slate-700 dark:hover:bg-slate-900/60"
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", action.bg)}>
                    <Icon className={cn("h-4 w-4", action.tint)} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">
                      {action.title}
                    </div>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {action.description}
                    </div>
                  </div>
                </div>
                <ArrowRight className="ml-3 h-4 w-4 shrink-0 text-slate-300 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400" />
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
