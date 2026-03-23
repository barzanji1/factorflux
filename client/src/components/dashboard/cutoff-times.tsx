import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock3, Landmark, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type CutoffItem = {
  title: string;
  subtitle: string;
  time: string;
  timezone: string;
  icon: LucideIcon;
  cardClassName: string;
  iconClassName: string;
  timeClassName: string;
  timezoneClassName: string;
};

const cutoffItems: CutoffItem[] = [
  {
    title: "ACH Cut-off",
    subtitle: "Automated Clearing House",
    time: "2:15 PM",
    timezone: "MST",
    icon: Landmark,
    cardClassName:
      "border-blue-200 bg-gradient-to-br from-blue-50 to-white dark:border-blue-900/40 dark:from-blue-950/20 dark:to-slate-950/30",
    iconClassName:
      "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    timeClassName: "text-blue-700 dark:text-blue-300",
    timezoneClassName: "text-blue-600 dark:text-blue-400",
  },
  {
    title: "WIRE Cut-off",
    subtitle: "Wire Transfer",
    time: "1:15 PM",
    timezone: "MST",
    icon: Zap,
    cardClassName:
      "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white dark:border-emerald-900/40 dark:from-emerald-950/20 dark:to-slate-950/30",
    iconClassName:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    timeClassName: "text-emerald-700 dark:text-emerald-300",
    timezoneClassName: "text-emerald-600 dark:text-emerald-400",
  },
];

export default function CutoffTimes() {
  return (
    <Card className="rounded-[22px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              <Clock3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              Daily Cut-off Times
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Funding deadlines for same-day processing
            </p>
          </div>

          <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
            Operations
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-6">
        {cutoffItems.map((item) => {
          const Icon = item.icon;

          return (
            <div
              key={item.title}
              className={cn(
                "rounded-[20px] border p-4",
                item.cardClassName
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-2xl",
                      item.iconClassName
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {item.title}
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {item.subtitle}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <p
                    className={cn(
                      "text-2xl font-bold tracking-tight",
                      item.timeClassName
                    )}
                  >
                    {item.time}
                  </p>
                  <p
                    className={cn(
                      "text-xs font-medium uppercase tracking-wide",
                      item.timezoneClassName
                    )}
                  >
                    {item.timezone}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
          <p className="text-center text-xs font-medium text-slate-500 dark:text-slate-400">
            All times are Mountain Standard Time (MST)
          </p>
        </div>
      </CardContent>
    </Card>
  );
}