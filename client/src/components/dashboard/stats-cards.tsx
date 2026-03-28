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
  iconClass: string;
};

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
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[140px] animate-pulse rounded-[18px] border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
          />
        ))}
      </div>
    );
  }

  const statItems: StatItem[] = [
    {
      title: "Pending Invoices",
      value: stats?.pendingInvoices ?? 0,
      change: "+12%",
      icon: Clock3,
      iconClass: "text-amber-500",
    },
    {
      title: "Processed Today",
      value: stats?.processedToday ?? 0,
      change: "+8%",
      icon: CheckCircle2,
      iconClass: "text-emerald-500",
    },
    {
      title: "Total Revenue",
      value: formatCurrency(stats?.totalRevenue),
      change: "+15%",
      icon: DollarSign,
      iconClass: "text-blue-500",
    },
    {
      title: "Active Clients",
      value: stats?.activeClients ?? 0,
      change: "+3",
      icon: Users,
      iconClass: "text-slate-500",
    },
  ];

  return (
    <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
      {statItems.map((item) => {
        const Icon = item.icon;

        return (
          <Card
            key={item.title}
            className="rounded-[18px] border border-slate-200/80 bg-white shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-[hsl(var(--card))]"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {item.title}
                  </p>

                  <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                    {item.value}
                  </p>

                  <div className="mt-2 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {item.change}
                  </div>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                  <Icon className={cn("h-5 w-5", item.iconClass)} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}