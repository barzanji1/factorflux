"use client";

import { ReactNode } from "react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";

interface AppShellProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

export function AppShell({ children, title, subtitle }: AppShellProps) {
  return (
    <div className="flex h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title={title} subtitle={subtitle} />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}