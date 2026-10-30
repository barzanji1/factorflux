import { useId, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Area, AreaChart, Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NeuButton, NeuCard, NeuStatCard } from "@/styles/neu";
import { CylinderBar } from "@/components/dashboard/FinancialOverview";
import { BROKER_CREDIT_GRADES, type BrokerFinancialSummary } from "@shared/broker-financial";

const gradeColors: Record<string, string> = { A: "#278260", B: "#168894", C: "#987500", D: "#b36725", F: "#b34343" };
const agingColors = ["#48a787", "#8da65b", "#d3b04d", "#d18a49", "#c56a65"];
const dollars = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const monthLabel = (value: string) => new Date(`${value}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const dateLabel = (value: number) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" });

function ChartCard({ title, note, report, children }: { title: string; note: string; report: string; children: ReactNode }) {
  return <NeuCard pressed className="min-w-0 p-4 sm:p-5">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-[#333]">{title}</h3>
      <Link href={report} className="text-xs font-medium text-[#168894] hover:underline">View in Reports →</Link>
    </div>
    <p className="mb-4 text-xs text-[#888]">{note}</p>{children}
  </NeuCard>;
}
function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="flex h-52 items-center justify-center text-center text-sm text-[#888]">{children}</div>;
}

export function BrokerFinancialOverview({ brokerId }: { brokerId: number }) {
  const gradientId = `broker-payment-${useId().replace(/:/g, "")}`;
  const query = useQuery<BrokerFinancialSummary>({
    queryKey: ["/api/brokers", brokerId, "financial-summary"],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/brokers/${brokerId}/financial-summary`, { credentials: "include", signal });
      if (!response.ok) throw new Error("Unable to load broker financial summary");
      return response.json();
    },
    enabled: Number.isSafeInteger(brokerId) && brokerId > 0,
    staleTime: 60_000,
    refetchOnMount: "always",
  });
  if (query.isLoading) return <section aria-label="Loading broker financial summary" aria-busy="true">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) =>
      <NeuCard key={index} className="h-28 animate-pulse bg-[#d6d6d6]" />)}</div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, index) =>
      <NeuCard pressed key={index} className="h-72 animate-pulse" />)}</div>
  </section>;
  if (query.error || !query.data) return <NeuCard className="p-5" role="alert">
    <p className="text-sm text-red-700">Unable to load broker financial summary.</p>
    <NeuButton className="mt-3" onClick={() => void query.refetch()}>Retry</NeuButton>
  </NeuCard>;
  const data = query.data;
  const report = (tab: string) => `/reports?tab=${tab}&brokerId=${brokerId}`;
  const monthly = data.months.map(row => ({ ...row, label: monthLabel(row.month) }));
  const history = data.creditHistory.map(row => ({ ...row, time: Date.parse(row.date) }));
  const arTotal = data.aging.reduce((sum, row) => sum + row.amount, 0);
  const stat = (label: string, value: ReactNode, detail: string) =>
    <NeuStatCard key={label} label={label} value={value} detail={detail} className="min-h-28 min-w-0 p-4 [&_p.text-3xl]:text-2xl" />;
  const teal = (value: string | number) => <span className="text-[#27aab8]">{value}</span>;
  return <section aria-label="Broker financial summary" className="space-y-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
      {stat("Total Invoiced", teal(dollars(data.totalInvoiced)), "Issued invoices · excludes drafts/rejected")}
      {stat("Open AR", teal(dollars(data.openAr)), "Open funded receivables")}
      {stat("Avg Days to Pay", teal(data.averageDaysToPay === null ? "—" : `${data.averageDaysToPay} days`), "Funding to first full cash payment")}
      {stat("Chargeback Count", teal(data.chargebackCount), "Invoices marked charged back")}
      {stat("Credit Grade", <span className="text-4xl font-bold" style={{ color: gradeColors[data.creditGrade ?? ""] ?? "#888" }}>{data.creditGrade || "—"}</span>,
        data.creditGrade ? "Current broker grade" : "Not yet graded")}
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Invoice Volume" note="Invoices per month · last six months · excludes drafts/rejected" report={report("broker")}>
        {monthly.some(row => row.invoices > 0) ? <div className="h-52 min-w-0" role="img"
          aria-label={monthly.map(row => `${row.label}: ${row.invoices} invoices`).join("; ")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ left: -20, top: 12, right: 8 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={value => [Number(value), "Invoices"]} />
              <Bar dataKey="invoices" shape={<CylinderBar />} maxBarSize={34} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div> : <EmptyChart>No invoices in the last six months.</EmptyChart>}
      </ChartCard>
      <ChartCard title="Payment Speed" note="Average days from funding to full cash payment · by payment month" report={report("global")}>
        {monthly.some(row => row.averageDaysToPay !== null) ? <div className="h-52 min-w-0" role="img"
          aria-label={monthly.map(row => `${row.label}: ${row.averageDaysToPay === null ? "no fully paid invoices" : `${row.averageDaysToPay} days`}`).join("; ")}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthly} margin={{ left: -20, top: 12, right: 8 }}>
              <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#27aab8" stopOpacity={0.5} /><stop offset="100%" stopColor="#27aab8" stopOpacity={0.03} />
              </linearGradient></defs>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={value => [`${Number(value).toFixed(1)} days`, "Avg days to pay"]} />
              <Area dataKey="averageDaysToPay" stroke="#27aab8" strokeWidth={2} fill={`url(#${gradientId})`} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div> : <EmptyChart>No fully cash-paid invoices in the last six months.</EmptyChart>}
      </ChartCard>
      <ChartCard title="Outstanding AR by Age" note="Open funded receivables · Denver calendar days since funding" report={report("aging")}>
        {arTotal > 0 ? <div className="flex min-h-52 flex-col justify-center gap-6">
          <div className="px-1 [perspective:700px]"><div className="flex h-10 rounded-lg shadow-[0_5px_0_#b5b5b5,0_8px_12px_#b8b8b8] [transform:rotateX(8deg)]"
            role="img" aria-label={data.aging.map(row => `${row.bucket}: ${dollars(row.amount)}`).join("; ")}>
            {data.aging.filter(row => row.amount > 0).map(row => <div key={row.bucket} title={`${row.bucket}: ${dollars(row.amount)}`}
              className="first:rounded-l-lg last:rounded-r-lg shadow-[inset_0_2px_2px_#ffffff55,inset_0_-3px_4px_#00000022]"
              style={{ width: `${row.amount / arTotal * 100}%`, background: agingColors[data.aging.indexOf(row)] }} />)}
          </div></div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {data.aging.map((row, index) => <span key={row.bucket} className="flex items-center gap-1.5 text-[#666]">
              <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: agingColors[index] }} />{row.bucket}: {dollars(row.amount)}
            </span>)}
          </div>
        </div> : <EmptyChart>No open funded receivables.</EmptyChart>}
      </ChartCard>
      <ChartCard title="Credit Score Trend" note="Recorded credit grades · last 12 months · up to 500 snapshots" report={report("broker")}>
        {history.length ? <div className="h-52 min-w-0" role="img" aria-label={`${history.length} recorded grades, from ${history[0].grade} to ${history[history.length - 1].grade}. Current grade: ${data.creditGrade || "not graded"}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ left: -20, top: 12, right: 16 }}>
              <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={dateLabel} tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} minTickGap={32} />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tickFormatter={value => BROKER_CREDIT_GRADES[Number(value) - 1] ?? ""} tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <Tooltip labelFormatter={value => new Date(Number(value)).toLocaleString("en-US", { timeZone: "America/Denver" })}
                formatter={(value, _name, item) => [`${BROKER_CREDIT_GRADES[Number(value) - 1]} (${item.payload.score}/100)`, "Credit grade"]} />
              <Line type="stepAfter" dataKey="gradeValue" stroke="#27aab8" strokeWidth={2} dot={{ r: history.length < 30 ? 3 : 1 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div> : <EmptyChart>No recorded credit history.{data.creditGrade ? ` Current grade: ${data.creditGrade}.` : ""}</EmptyChart>}
      </ChartCard>
    </div>
  </section>;
}
