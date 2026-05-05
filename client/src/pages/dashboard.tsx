import { AppShell } from "@/components/layout/AppShell";
import StatsCards from "@/components/dashboard/stats-cards";
import QuickActions from "@/components/dashboard/quick-actions";
import RecentActivity from "@/components/dashboard/recent-activity";
import RecentInvoices from "@/components/dashboard/recent-invoices";
import TimeClock from "@/components/time-tracking/time-clock";
import CutoffTimes from "@/components/dashboard/cutoff-times";
import { ShieldCheck } from "lucide-react";

export default function Dashboard() {
  return (
    <AppShell
      title="Command"
      subtitle="Live freight operations — track, fund, and manage from one workspace"
    >
      <section className="relative mb-8 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.06),transparent_45%),radial-gradient(ellipse_at_bottom_left,rgba(16,185,129,0.03),transparent_40%)]" />
        <div className="absolute right-0 top-0 h-px w-1/2 bg-gradient-to-l from-transparent via-blue-300/30 to-transparent dark:via-blue-700/20" />

        <div className="relative p-6 lg:p-8">
          <div className="max-w-3xl">
            <div className="mb-4 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/60 bg-blue-50/60 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-600 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-400">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.7)]" />
                FactorFlux · Live
              </span>
            </div>

            <h2 className="text-[1.7rem] font-semibold tracking-tight text-slate-900 dark:text-white lg:text-[2rem]">
              Freight Operations Center
            </h2>

            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400 lg:text-[15px]">
              Your unified operating layer for freight factoring, document intake,
              carrier management, and the full payment lifecycle.
            </p>

            <div className="mt-5 h-px w-full max-w-sm bg-gradient-to-r from-slate-200 to-transparent dark:from-slate-700" />

            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/80 px-3 py-1.5 text-[11px] font-medium text-slate-600 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              Secured internal workspace — Trucking Pros Financial
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <StatsCards />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-6">
          <TimeClock />
          <CutoffTimes />
        </div>
        <div className="space-y-6">
          <QuickActions />
        </div>
        <div className="space-y-6 lg:col-span-2 xl:col-span-1">
          <RecentActivity />
        </div>
      </section>

      <section className="mt-8">
        <RecentInvoices />
      </section>
    </AppShell>
  );
}