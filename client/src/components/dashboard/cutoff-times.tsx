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
  iconClassName: string;
};

const cutoffItems: CutoffItem[] = [
  {
    title: "ACH Cut-off",
    subtitle: "Automated Clearing House",
    time: "2:15 PM",
    timezone: "MST",
    icon: Landmark,
    iconClassName: "text-blue-500",
  },
  {
    title: "Wire Cut-off",
    subtitle: "Wire Transfer",
    time: "1:15 PM",
    timezone: "MST",
    icon: Zap,
    iconClassName: "text-emerald-500",
  },
];

export default function CutoffTimes() {
  return (
    <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            <Clock3 className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            Daily Cut-off Times
          </CardTitle>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Funding deadlines for same-day processing
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 p-5">
        {cutoffItems.map((item) => {
          const Icon = item.icon;

          return (
            <div
              key={item.title}
              className="rounded-[18px] border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white dark:bg-slate-800">
                    <Icon className={cn("h-4.5 w-4.5", item.iconClassName)} />
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
                  <p className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                    {item.time}
                  </p>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                    {item.timezone}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        <div className="rounded-[18px] border border-dashed border-slate-200 px-4 py-3 dark:border-slate-800">
          <p className="text-center text-xs font-medium text-slate-500 dark:text-slate-400">
            All times shown in Mountain Standard Time
          </p>
        </div>
      </CardContent>
    </Card>
  );
}