import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Clock3, CheckCircle2, DollarSign, Truck, TrendingUp } from "lucide-react";
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
  tint: "amber" | "emerald" | "blue" | "violet";
};

function formatCurrency(value: string | number | undefined) {
  const amount = Number(value ?? 0);
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TINT_CLASSES = {
  amber:   { bg: "bg-amber-50  dark:bg-amber-950/20",   icon: "text-amber-500",   ring: "ring-amber-200/60  dark:ring-amber-900/30"   },
  emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/20", icon: "text-emerald-500", ring: "ring-emerald-200/60 dark:ring-emerald-900/30" },
  blue:    { bg: "bg-blue-50   dark:bg-blue-950/20",    icon: "text-blue-500",    ring: "ring-blue-200/60   dark:ring-blue-900/30"    },
  violet:  { bg: "bg-violet-50 dark:bg-violet-950/20",  icon: "text-violet-500",  ring: "ring-violet-200/60 dark:ring-violet-900/30"  },
};

export default function StatsCards() {
  const { data: stats, isLoading, isError } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (isLoading) return (
    <div className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-[130px] animate-pulse rounded-[20px] border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800" />
      ))}
    </div>
  );

  if (isError) return (
    <div className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex h-[130px] items-center justify-center rounded-[20px] border border-red-100 bg-red-50/50 dark:border-red-900/30 dark:bg-red-950/10">
          <span className="text-xs text-red-500">Failed to load</span>
        </div>
      ))}
    </div>
  );

  const statItems: StatItem[] = [
    { title: "Loads Pending",    value: stats?.pendingInvoices ?? 0,       change: "+12%", icon: Clock3,         tint: "amber"   },
    { title: "Funded Today",     value: stats?.processedToday ?? 0,        change: "+8%",  icon: CheckCircle2,   tint: "emerald" },
    { title: "Total Funded",     value: formatCurrency(stats?.totalRevenue), change: "+15%", icon: DollarSign,   tint: "blue"    },
    { title: "Active Carriers",  value: stats?.activeClients ?? 0,         change: "+3",   icon: Truck,          tint: "violet"  },
  ];

  return (
    <div className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
      {statItems.map(item => {
        const Icon = item.icon;
        const t = TINT_CLASSES[item.tint];
        return (
          <Card key={item.title}
            className="rounded-[20px] border border-slate-200/80 bg-white shadow-[0_4px_16px_rgba(15,23,42,0.05)] transition-all duration-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-[hsl(var(--card))]">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                    {item.title}
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                    {item.value}
                  </p>
                  <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                    <TrendingUp className="h-3 w-3" />
                    <span>{item.change} this period</span>
                  </div>
                </div>
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl ring-1", t.bg, t.ring)}>
                  <Icon className={cn("h-5 w-5", t.icon)} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
