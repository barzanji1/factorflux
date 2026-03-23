import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import {
  Plus,
  UserPlus,
  TrendingUp,
  FolderOpen,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

type QuickActionItem = {
  title: string;
  description: string;
  icon: LucideIcon;
  iconWrap: string;
  href: string;
};

export default function QuickActions() {
  const [, setLocation] = useLocation();

  const actions: QuickActionItem[] = [
    {
      title: "New Invoice",
      description: "Create and issue a new invoice",
      icon: Plus,
      iconWrap: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
      href: "/invoices",
    },
    {
      title: "Add Client",
      description: "Create a new client record",
      icon: UserPlus,
      iconWrap:
        "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
      href: "/clients",
    },
    {
      title: "View Reports",
      description: "Open the reporting dashboard",
      icon: TrendingUp,
      iconWrap: "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400",
      href: "/reports",
    },
    {
      title: "Upload Documents",
      description: "Add freight and support files",
      icon: FolderOpen,
      iconWrap: "bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400",
      href: "/documents",
    },
  ];

  return (
    <Card className="rounded-[22px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              Quick Actions
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Launch common workflows in one click
            </p>
          </div>

          <div className="hidden items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/30 dark:text-violet-300 sm:inline-flex">
            <Sparkles className="h-3.5 w-3.5" />
            Workflow shortcuts
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        <div className="space-y-3">
          {actions.map((action) => {
            const Icon = action.icon;

            return (
              <button
                key={action.title}
                type="button"
                onClick={() => setLocation(action.href)}
                className={cn(
                  "group flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200",
                  "hover:-translate-y-0.5 hover:border-blue-100 hover:bg-slate-50/80 hover:shadow-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2",
                  "ring-offset-[hsl(var(--background))]",
                  "dark:border-slate-800 dark:bg-transparent dark:hover:border-blue-950/40 dark:hover:bg-slate-900/40"
                )}
                aria-label={action.title}
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                      action.iconWrap
                    )}
                  >
                    <Icon className="h-5 w-5" />
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

                <div className="ml-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition-all duration-200 group-hover:bg-white group-hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-slate-700 dark:group-hover:text-white">
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