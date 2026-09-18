"use client";

import { ReactNode } from "react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";

interface AppShellProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  group?: string;
}

export function AppShell({ children, title, subtitle, group }: AppShellProps) {
  return (
    <div className="ff-app-shell flex min-h-[100dvh] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title={title} subtitle={subtitle} group={group} />

        <main className="custom-scrollbar min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-3 sm:p-4 xl:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
