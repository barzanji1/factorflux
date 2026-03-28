import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import {
  Plus,
  UserPlus,
  TrendingUp,
  FolderOpen,
  ArrowRight,
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

type QuickActionItem = {
  title: string;
  description: string;
  icon: LucideIcon;
  iconClass: string;
  href: string;
};

export default function QuickActions() {
  const [, setLocation] = useLocation();

  const actions: QuickActionItem[] = [
    {
      title: "New Invoice",
      description: "Create and issue a new invoice",
      icon: Plus,
      iconClass: "text-blue-500",
      href: "/invoices",
    },
    {
      title: "Add Client",
      description: "Create a new client record",
      icon: UserPlus,
      iconClass: "text-emerald-500",
      href: "/clients",
    },
    {
      title: "View Reports",
      description: "Open the reporting dashboard",
      icon: TrendingUp,
      iconClass: "text-amber-500",
      href: "/reports",
    },
    {
      title: "Upload Documents",
      description: "Add freight and support files",
      icon: FolderOpen,
      iconClass: "text-violet-500",
      href: "/documents",
    },
  ];

  return (
    <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800">
        <div>
          <CardTitle className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            Quick Actions
          </CardTitle>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Launch common workflows in one click
          </p>
        </div>
      </CardHeader>

      <CardContent className="p-5">
        <div className="space-y-3">
          {actions.map((action) => {
            const Icon = action.icon;

            return (
              <button
                key={action.title}
                type="button"
                onClick={() => setLocation(action.href)}
                className={cn(
                  "group flex w-full items-center justify-between rounded-[18px] border border-slate-200/80 bg-slate-50/60 p-4 text-left transition",
                  "hover:border-slate-300 hover:bg-slate-50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2",
                  "ring-offset-[hsl(var(--background))]",
                  "dark:border-slate-800 dark:bg-slate-900/30 dark:hover:border-slate-700 dark:hover:bg-slate-900/50"
                )}
                aria-label={action.title}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-slate-800">
                    <Icon className={cn("h-4.5 w-4.5", action.iconClass)} />
                  </div>

                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {action.title}
                    </div>
                    <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                      {action.description}
                    </div>
                  </div>
                </div>

                <div className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition group-hover:text-slate-700 dark:text-slate-500 dark:group-hover:text-slate-200">
                  <ArrowRight className="h-4 w-4" />
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}