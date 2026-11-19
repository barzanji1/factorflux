import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeDollarSign, ShieldCheck } from "lucide-react";
import Sidebar from "@/components/layout/sidebar";
import { AdminPageShell, Card, CardContent, StatCard, TopNav } from "@/components/admin-neu/adapters";
import "@/components/admin-neu/admin-neu-page.css";
import { useAuth } from "@/hooks/useAuth";
import type { PayStatement, PayrollList } from "../../../shared/contractor-payroll";
import { PayrollStatements } from "@/components/payroll/PayrollStatements";
import { PayrollAdminPanel, ReissueDialog } from "@/components/payroll/PayrollAdmin";
import { ErrorNotice, money } from "@/components/payroll/payroll-utils";

export default function ContractorPayroll() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";
  const [page, setPage] = useState(1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [reissueStatement, setReissueStatement] = useState<PayStatement | null>(null);
  const key = `/api/contractor-payroll?page=${page}&year=${year}`;
  const payroll = useQuery<PayrollList>({ queryKey: [key], enabled: !authLoading && !!user });

  return <div className="flex min-h-[100dvh] overflow-hidden bg-background">
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <TopNav title="Contractor pay" />
      <AdminPageShell className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-[1500px] space-y-7">
          <header className="flex flex-wrap items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BadgeDollarSign className="h-6 w-6" /></div>
            <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">Trucking Pros LLC</p><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Contractor pay</h1><p className="mt-1 text-sm text-muted-foreground">1099 contractor — no taxes withheld</p></div>
            <div className="flex items-center gap-2 rounded-full bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-primary" />{isAdmin ? "Admin access" : "Private to your account"}</div>
          </header>

          {payroll.isError && <ErrorNotice message={payroll.error instanceof Error ? payroll.error.message : "Could not load your pay statements."} onRetry={() => payroll.refetch()} />}
          {payroll.isLoading ? <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><div className="h-28 animate-pulse rounded-2xl bg-muted/50" /><div className="h-28 animate-pulse rounded-2xl bg-muted/50" /></div><div className="h-72 animate-pulse rounded-2xl bg-muted/50" /></div> : payroll.data &&
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <StatCard label={`${year} year-to-date gross`} value={money(payroll.data.ytdGrossCents)} className="min-h-0" />
                <Card><CardContent className="flex h-full min-h-[105px] flex-col justify-center pt-5"><div className="text-sm text-muted-foreground">Statement access</div><div className="mt-1 font-semibold">{payroll.data.statements.length ? "Your issued records are ready" : "Waiting for the first issued statement"}</div><p className="mt-1 text-xs text-muted-foreground">PDFs are printable and include the hourly rate used for each statement.</p></CardContent></Card>
              </div>
              <PayrollStatements data={payroll.data} page={page} year={year} onPage={setPage} onYear={setYear} isAdmin={isAdmin} onReissue={setReissueStatement} />
              {isAdmin && <PayrollAdminPanel onReissue={setReissueStatement} />}
            </>}
        </div>
      </AdminPageShell>
    </div>
    {isAdmin && <ReissueDialog statement={reissueStatement} onClose={() => setReissueStatement(null)} />}
  </div>;
}
