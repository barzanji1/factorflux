import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NeuButton, NeuCard, NeuStatCard } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { CylinderBar } from "@/components/dashboard/FinancialOverview";
import type { CarrierFinancialSummary } from "@shared/carrier-financial";

const colors = ["#27aab8", "#73d0d4", "#468e99", "#9aa7ab"];
const agingColors = ["#48a787", "#8da65b", "#d3b04d", "#d18a49", "#c56a65"];
const dollars = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const compact = (value: number) => value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
const monthLabel = (value: string) => new Date(`${value}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

function ChartCard({ title, report, children, note }: {
  title: string; report: string; children: React.ReactNode; note: string;
}) {
  return <NeuCard pressed className="min-w-0 p-4 sm:p-5">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-[#333]">{title}</h3>
      <Link href={report} className="text-xs font-medium text-[#168894] hover:underline">View in Reports →</Link>
    </div>
    <p className="mb-4 text-xs text-[#888]">{note}</p>
    {children}
  </NeuCard>;
}
function EmptyChart({ children }: { children: React.ReactNode }) {
  return <div className="flex h-52 items-center justify-center text-center text-sm text-[#888]">{children}</div>;
}

export function CarrierFinancialOverview({ carrierId }: { carrierId: number }) {
  const gradientId = `carrier-payment-${useId().replace(/:/g, "")}`;
  const { data, isLoading, error, refetch } = useQuery<CarrierFinancialSummary>({
    queryKey: ["/api/clients", carrierId, "financial-summary"],
    queryFn: async () => {
      const response = await fetch(`/api/clients/${carrierId}/financial-summary`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load carrier financial summary");
      return response.json();
    },
    enabled: Number.isSafeInteger(carrierId) && carrierId > 0,
    staleTime: 60_000,
    refetchOnMount: "always",
  });
  if (isLoading) return <section aria-label="Loading carrier financial summary" aria-busy="true">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) =>
      <NeuCard key={index} className="h-28 animate-pulse bg-[#d6d6d6]" />)}</div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, index) =>
      <NeuCard pressed key={index} className="h-72 animate-pulse" />)}</div>
  </section>;
  if (error || !data) return <NeuNotice severity="block" role="alert">
    <p className="text-sm">Unable to load carrier financial summary.</p>
    <NeuButton className="mt-3" onClick={() => void refetch()}>Retry</NeuButton>
  </NeuNotice>;
  const fundedTotal = data.revenue.reduce((sum, row) => sum + row.amount, 0);
  const hasPayments = data.months.some(row => row.averageDaysToPay !== null);
  const arTotal = data.aging.reduce((sum, row) => sum + row.amount, 0);
  const report = (tab: string) => `/reports?tab=${tab}&carrierId=${carrierId}`;
  const stat = (label: string, value: string, detail: string) =>
    <NeuStatCard key={label} label={label} value={<span className="text-[#27aab8]">{value}</span>}
      detail={detail} className="min-h-28 min-w-0 p-4 [&_p.text-3xl]:text-2xl" />;
  return <section aria-label="Carrier financial summary" className="space-y-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {stat("Total Funded", dollars(data.totalFunded), "Funded invoice face value")}
      {stat("Open AR", dollars(data.openAr), "Current open funded receivables")}
      {stat("Avg Days to Pay", data.averageDaysToPay === null ? "—" : `${data.averageDaysToPay} days`, "From funding to full cash payment")}
      {stat("Chargeback Rate", `${data.chargebackRate}%`, "Charged-back / funded invoices")}
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Invoice Volume" report={report("carrier")} note="Invoices per month · last six months · excludes drafts and rejected">
        {data.months.some(row => row.invoices > 0) ? <div className="h-52 min-w-0" role="img"
          aria-label={data.months.map(row => `${monthLabel(row.month)}: ${row.invoices} invoices`).join("; ")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.months.map(row => ({ ...row, label: monthLabel(row.month) }))} margin={{ left: -20, top: 12, right: 8 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={value => [Number(value), "Invoices"]} />
              <Bar dataKey="invoices" shape={<CylinderBar />} maxBarSize={34} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div> : <EmptyChart>No invoices in the last six months.</EmptyChart>}
      </ChartCard>
      <ChartCard title="Revenue by Load Type" report={report("carrier")} note="Funded invoice amounts · all time">
        {fundedTotal > 0 ? <>
          <div className="relative h-44 min-w-0" role="img" aria-label={data.revenue.map(row => `${row.label}: ${dollars(row.amount)}`).join("; ")}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={data.revenue.filter(row => row.amount > 0)} dataKey="amount" nameKey="label" innerRadius="60%" outerRadius="85%" stroke="none" isAnimationActive={false}>
                {data.revenue.filter(row => row.amount > 0).map(row => <Cell key={row.type} fill={colors[data.revenue.indexOf(row)]} />)}
              </Pie><Tooltip formatter={value => dollars(Number(value))} /></PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xs text-[#888]">Total</span><strong className="text-base text-[#168894]">${compact(fundedTotal)}</strong>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-[#666]">
            {data.revenue.map((row, index) => <span key={row.type} className="inline-flex items-center gap-1">
              <i className="h-2 w-2 rounded-full" style={{ background: colors[index] }} />{row.label}: {dollars(row.amount)}
            </span>)}
          </div>
        </> : <EmptyChart>No funded invoices yet.</EmptyChart>}
      </ChartCard>
      <ChartCard title="Aging Snapshot" report={report("aging")} note="Open funded receivables · Denver calendar days since funding">
        {arTotal > 0 ? <div className="flex min-h-52 flex-col justify-center gap-6">
          <div className="px-1 [perspective:700px]">
            <div className="flex h-10 rounded-lg shadow-[0_5px_0_#b5b5b5,0_8px_12px_#b8b8b8] [transform:rotateX(8deg)]" role="img"
              aria-label={data.aging.map(row => `${row.bucket}: ${dollars(row.amount)}`).join("; ")}>
              {data.aging.filter(row => row.amount > 0).map(row => <div key={row.bucket} title={`${row.bucket}: ${dollars(row.amount)}`}
                className="first:rounded-l-lg last:rounded-r-lg shadow-[inset_0_2px_2px_#ffffff55,inset_0_-3px_4px_#00000022]"
                style={{ width: `${row.amount / arTotal * 100}%`, background: agingColors[data.aging.indexOf(row)] }} />)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {data.aging.map((row, index) => <span key={row.bucket} className="flex items-center gap-1.5 text-[#666]">
              <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: agingColors[index] }} />
              {row.bucket}: {dollars(row.amount)}
            </span>)}
          </div>
        </div> : <EmptyChart>No open funded receivables.</EmptyChart>}
      </ChartCard>
      <ChartCard title="Payment Performance" report={report("global")} note="Average days from funding to full cash payment · by payment month">
        {hasPayments ? <div className="h-52 min-w-0" role="img"
          aria-label={data.months.map(row => `${monthLabel(row.month)}: ${row.averageDaysToPay === null ? "no fully paid invoices" : `${row.averageDaysToPay} days`}`).join("; ")}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.months.map(row => ({ ...row, label: monthLabel(row.month) }))} margin={{ left: -20, top: 12, right: 8 }}>
              <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#27aab8" stopOpacity={0.5} /><stop offset="100%" stopColor="#27aab8" stopOpacity={0.03} />
              </linearGradient></defs>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={value => [`${Number(value).toFixed(1)} days`, "Avg days to pay"]} />
              <Area dataKey="averageDaysToPay" stroke="#27aab8" strokeWidth={2} fill={`url(#${gradientId})`} dot={{ r: 3 }}
                connectNulls={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div> : <EmptyChart>No fully cash-paid invoices in the last six months.</EmptyChart>}
      </ChartCard>
    </div>
  </section>;
}
