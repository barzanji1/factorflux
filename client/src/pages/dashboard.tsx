import { AppShell } from "@/components/layout/AppShell";
import StatsCards from "@/components/dashboard/stats-cards";
import DocumentUpload from "@/components/dashboard/document-upload";
import QuickActions from "@/components/dashboard/quick-actions";
import RecentActivity from "@/components/dashboard/recent-activity";
import RecentInvoices from "@/components/dashboard/recent-invoices";
import TimeClock from "@/components/time-tracking/time-clock";
import CutoffTimes from "@/components/dashboard/cutoff-times";
import tpfLogo from "@assets/2026-TPF_Logo_1765652205621.png";
import { Sparkles, ShieldCheck, Activity } from "lucide-react";

export default function Dashboard() {
  return (
    <AppShell
      title="Dashboard"
      subtitle="Welcome back — manage your freight factoring workflow from one command center"
    >
      <section className="relative mb-8 overflow-hidden rounded-[28px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.12),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(6,182,212,0.10),transparent_28%)]" />

        <div className="relative flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between lg:p-8">
          <div className="flex min-w-0 flex-1 items-start gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-[0_18px_34px_rgba(37,99,235,0.22)]">
              <Sparkles className="h-7 w-7" />
            </div>

            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                  FactorFlux OS
                </span>
                <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
                  Internal Operations Suite
                </span>
              </div>

              <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white lg:text-3xl">
                Welcome to FactorFlux
              </h2>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300 lg:text-base">
                Your central operating system for freight factoring, document
                intake, invoice visibility, workflow tracking, and team execution.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Secure internal workspace
                </div>

                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <Activity className="h-3.5 w-3.5" />
                  Live workflow visibility
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start gap-4 lg:items-end">
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-5 py-4 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/70">
              <img
                src={tpfLogo}
                alt="Trucking Pros Financial"
                className="h-10 w-auto object-contain"
              />
            </div>

            <div className="text-left lg:text-right">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Powered by Trucking Pros Financial
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Professional freight factoring solutions
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Designed and developed by Dosh Barzanji
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <StatsCards />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <DocumentUpload />
        </div>

        <div className="space-y-6 xl:col-span-4">
          <TimeClock />
          <CutoffTimes />
          <QuickActions />
          <RecentActivity />
        </div>
      </section>

      <section className="mt-8">
        <RecentInvoices />
      </section>
    </AppShell>
  );
}