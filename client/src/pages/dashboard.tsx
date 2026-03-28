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
      title="Dashboard"
      subtitle="Welcome back — manage your freight factoring workflow from one command center"
    >
      <section className="relative mb-8 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.05),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(6,182,212,0.03),transparent_26%)]" />

        <div className="relative p-6 lg:p-8">
          <div className="max-w-3xl">
            <div className="mb-5">
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                FactorFlux OS
              </span>
            </div>

            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white lg:text-[2rem]">
              Welcome to FactorFlux
            </h2>

            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300 lg:text-[15px]">
              Your central operating system for freight factoring, document
              intake, invoice visibility, and workflow execution.
            </p>

            <div className="mt-6 h-px w-full max-w-xl bg-gradient-to-r from-slate-200 via-slate-200/70 to-transparent dark:from-slate-700 dark:via-slate-700/70 dark:to-transparent" />

            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Secure internal workspace
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