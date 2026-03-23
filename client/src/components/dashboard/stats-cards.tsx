import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  Clock3,
  CheckCircle2,
  DollarSign,
  Users,
  TrendingUp,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DashboardStats = {
  pendingInvoices?: number;
  processedToday?: number;
  totalRevenue?: string | number;
  activeClients?: number;
};

type StatItem = {
  title: string;
  value: string | number;
  change: string;
  icon: LucideIcon;
  iconWrapperClass: string;
  iconClass: string;
  trendTone: string;
  bars: number[];
};

function MiniBars({ bars }: { bars: number[] }) {
  return (
    <div className="mt-5 flex h-10 items-end gap-1.5">
      {bars.map((bar, index) => (
        <div
          key={`${bar}-${index}`}
          className="flex-1 rounded-full bg-blue-100 dark:bg-blue-950/30"
          style={{
            height: `${bar}%`,
            minHeight: "18%",
          }}
        />
      ))}
    </div>
  );
}

function StatsCardSkeleton() {
  return (
    <Card className="overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
      <CardContent className="p-6">
        <div className="animate-pulse">
          <div className="mb-4 flex items-start justify-between">
            <div className="w-full">
              <div className="mb-3 h-4 w-28 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="mb-3 h-9 w-24 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-6 w-32 rounded-full bg-slate-200 dark:bg-slate-700" />
            </div>
            <div className="h-12 w-12 rounded-2xl bg-slate-200 dark:bg-slate-700" />
          </div>

          <div className="mt-5 flex h-10 items-end gap-1.5">
            {[38, 50, 44, 66, 58, 76, 68].map((bar, index) => (
              <div
                key={index}
                className="flex-1 rounded-full bg-slate-200 dark:bg-slate-700"
                style={{ height: `${bar}%` }}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatCurrency(value: string | number | undefined) {
  const amount = Number(value ?? 0);

  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function StatsCards() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (isLoading) {
    return (
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatsCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  const statItems: StatItem[] = [
    {
      title: "Pending Invoices",
      value: stats?.pendingInvoices ?? 0,
      change: "+12% from last month",
      icon: Clock3,
      iconWrapperClass: "bg-amber-50 dark:bg-amber-950/30",
      iconClass: "text-amber-600 dark:text-amber-400",
      trendTone:
        "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
      bars: [32, 44, 40, 60, 52, 72, 64],
    },
    {
      title: "Processed Today",
      value: stats?.processedToday ?? 0,
      change: "+8% from yesterday",
      icon: CheckCircle2,
      iconWrapperClass: "bg-emerald-50 dark:bg-emerald-950/30",
      iconClass: "text-emerald-600 dark:text-emerald-400",
      trendTone:
        "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
      bars: [24, 38, 34, 50, 62, 74, 82],
    },
    {
      title: "Total Revenue",
      value: formatCurrency(stats?.totalRevenue),
      change: "+15% from last month",
      icon: DollarSign,
      iconWrapperClass: "bg-blue-50 dark:bg-blue-950/30",
      iconClass: "text-blue-600 dark:text-blue-400",
      trendTone:
        "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
      bars: [22, 36, 42, 56, 62, 74, 88],
    },
    {
      title: "Active Clients",
      value: stats?.activeClients ?? 0,
      change: "+3 new this week",
      icon: Users,
      iconWrapperClass: "bg-slate-100 dark:bg-slate-800",
      iconClass: "text-slate-700 dark:text-slate-300",
      trendTone:
        "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
      bars: [30, 30, 42, 48, 54, 62, 70],
    },
  ];

  return (
    <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
      {statItems.map((item) => {
        const Icon = item.icon;

        return (
          <Card
            key={item.title}
            className="group overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-white shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(37,99,235,0.10)] dark:bg-[hsl(var(--card))]"
          >
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    {item.title}
                  </p>

                  <p className="mt-2 truncate text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                    {item.value}
                  </p>

                  <div
                    className={cn(
                      "mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                      item.trendTone
                    )}
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    <span>{item.change}</span>
                  </div>
                </div>

                <div
                  className={cn(
                    "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-sm transition-transform duration-200 group-hover:scale-105",
                    item.iconWrapperClass
                  )}
                >
                  <Icon className={cn("h-6 w-6", item.iconClass)} />
                </div>
              </div>

              <MiniBars bars={item.bars} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}