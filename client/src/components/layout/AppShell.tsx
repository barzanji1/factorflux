"use client";

import { ReactNode } from "react";
import "@/styles/neu/dashboard.css";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { NeuPageShell } from "@/styles/neu";
import { PageSnapshotFrame } from "@/components/loading/PageSnapshotFrame";

interface AppShellProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  group?: string;
  neu?: boolean;
  actions?: ReactNode;
  className?: string;
}

export function AppShell({ children, title, subtitle, group, neu = false, actions, className }: AppShellProps) {
  return (
    <div className={`${neu ? "ff-neu-app-shell" : "ff-app-shell"} ${className ?? ""} flex min-h-[100dvh] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]`}>
      <Sidebar />

      <div className={`flex min-w-0 flex-1 flex-col overflow-hidden ${neu ? "ff-neu-main-column" : ""}`}>
        <TopNav title={title} subtitle={subtitle} group={group} neu={neu} actions={actions} />

        {neu ? (
          <NeuPageShell className="ff-neu-page-shell custom-scrollbar min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-5 sm:py-6 xl:px-8">
            <div className="mx-auto w-full max-w-[1680px]">{children}</div>
          </NeuPageShell>
        ) : (
          <main className="custom-scrollbar relative min-h-0 flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[1680px] p-3 sm:p-4 xl:p-6">
              <PageSnapshotFrame>{children}</PageSnapshotFrame>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
