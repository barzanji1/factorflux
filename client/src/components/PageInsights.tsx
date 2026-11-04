import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertCircle, RotateCcw } from "lucide-react";
import type { PageInsights as PageInsightsData, InsightEntity } from "@shared/page-insights";
import { CylinderBar } from "@/components/dashboard/FinancialOverview";
import { NeuButton, NeuCard, NeuStatCard } from "@/styles/neu";
import "./page-insights.css";

type Props = {
  entity: InsightEntity | "loads";
  entityId?: string | number;
  clientId?: string | number;
  title?: string;
  enabled?: boolean;
  section?: string;
};

const colors = ["#1f9299", "#e0a44d", "#718b83", "#bc7462", "#8297a0"];
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat();

async function loadInsights(entity: InsightEntity | "loads", entityId?: string | number, clientId?: string | number, signal?: AbortSignal, section?: string) {
  const params = new URLSearchParams({ insights: "1" });
  if (entityId !== undefined && entityId !== "") params.set("entityId", String(entityId));
  if (clientId !== undefined && clientId !== "") params.set("clientId", String(clientId));
  if (section) params.set("section", section);
  const response = await fetch(`/api/${entity}/stats?${params}`, { credentials: "include", signal });
  if (!response.ok) throw new Error(`Insights request failed (${response.status})`);
  return response.json() as Promise<PageInsightsData>;
}

function StatSkeleton() {
  return <div className="h-[88px] animate-pulse rounded-2xl bg-[#d6dfdc] shadow-[inset_4px_4px_8px_#bcc6c3,inset_-4px_-4px_8px_#f2f7f5]" />;
}

export function PageInsights({ entity, entityId, clientId, title = "Operational pulse", enabled = true, section }: Props) {
  const gradientId = `insights-${useId().replace(/:/g, "")}`;
  const queryClient = useQueryClient();
  useEffect(() => {
    const aliases: Partial<Record<InsightEntity, string[]>> = {
      sheets: ["/api/funding/queue"], factoring: ["/api/invoices"], held: ["/api/invoices"],
      "fuel-advance": ["/api/fuel-advances"], "fmcsa-authority": ["/api/authority-checks"],
      "audit-log": ["/api/audit"], exceptions: ["/api/chargebacks"],
      followups: ["/api/follow-ups", "/api/broker-collections"],
      reports: ["/api/invoices", "/api/reports"], collections: ["/api/invoices", "/api/broker-collections"],
    };
    const roots = [`/api/${entity}`, ...(aliases[entity] ?? [])];
    return queryClient.getQueryCache().subscribe(event => {
      if (event.type !== "updated" || event.action.type !== "invalidate") return;
      const root = event.query.queryKey[0];
      if (typeof root === "string" && roots.some(prefix => root === prefix || root.startsWith(`${prefix}/`))) {
        void queryClient.invalidateQueries({ queryKey: ["page-insights", entity] });
      }
    });
  }, [entity, queryClient]);
  const query = useQuery({
    queryKey: ["page-insights", entity, entityId ?? null, clientId ?? null, section ?? null],
    queryFn: ({ signal }) => loadInsights(entity, entityId, clientId, signal, section),
    enabled: enabled && (entity !== "vault" || clientId !== undefined && clientId !== ""),
    staleTime: 60_000,
    refetchInterval: 60_000,
    gcTime: 60_000,
    retry: 1,
  });
  const data = query.data;
  const value = (amount: number, format: "number" | "currency") =>
    format === "currency" ? money.format(amount) : number.format(amount);

  return (
    <section className="mb-5 space-y-3" aria-label={`${title} insights`} data-insights-entity={entity}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#63807a]">Full dataset · 60 second refresh</p>
          <h2 className="text-lg font-bold tracking-tight text-[#354b47]">{title}</h2>
        </div>
        {query.isFetching && !query.isPending && <span className="text-[11px] text-[#71827e]">Updating</span>}
      </div>
      {query.isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[0, 1, 2].map((item) => <StatSkeleton key={item} />)}</div>
      ) : query.isError ? (
        <NeuCard className="flex flex-wrap items-center justify-between gap-3 p-4" role="alert">
          <span className="flex items-center gap-2 text-sm text-[#76594e]"><AlertCircle className="h-4 w-4" /> Insights are temporarily unavailable.</span>
          <NeuButton onClick={() => query.refetch()} className="min-h-9 px-3"><RotateCcw className="h-4 w-4" />Retry</NeuButton>
        </NeuCard>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <NeuStatCard label="Total records" value={<span className="insight-number">{number.format(data.total)}</span>} detail="Across the full dataset" className="insight-stat min-h-[88px] p-3" />
            <NeuStatCard label={data.openLabel ?? "Open / active"} value={<span className="insight-number">{number.format(data.open)}</span>} detail="Current activity" className="insight-stat min-h-[88px] p-3" />
            <NeuStatCard label={data.keyMetric.label} value={<span className="insight-number">{value(data.keyMetric.value, data.keyMetric.format)}</span>} detail="Key operational measure" className="insight-stat min-h-[88px] p-3" />
          </div>
          {(data.series.length > 0 || data.breakdown.length > 0) && (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {data.series.length > 0 && (
                <NeuCard pressed className="insight-chart min-w-0 p-3 sm:p-4">
                  <div className="mb-2"><p className="text-xs font-bold text-[#3d5751]">Activity over time</p><p className="text-[10px] text-[#75847f]">Record volume and value by period</p></div>
                  <div className="h-[210px] w-full" role="img" aria-label="Activity and amount over time">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.series} margin={{ top: 12, right: 4, left: -18, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="#8c9995" strokeOpacity={0.18} />
                        <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: "#76837f", fontSize: 10 }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fill: "#76837f", fontSize: 9 }} />
                        <Tooltip formatter={(v, name) => [name === "amount" ? money.format(Number(v)) : number.format(Number(v)), name === "amount" ? "Amount" : "Records"]} />
                        <Bar dataKey="count" shape={<CylinderBar />} maxBarSize={25} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </NeuCard>
              )}
              {data.series.length > 0 && (
                <NeuCard pressed className="insight-chart min-w-0 p-3 sm:p-4">
                  <div className="mb-2"><p className="text-xs font-bold text-[#3d5751]">{data.keyMetric.format === "currency" ? "Amount trend" : "Activity trend"}</p><p className="text-[10px] text-[#75847f]">Full-dataset trend by period</p></div>
                  <div className="h-[210px] w-full" role="img" aria-label="Amount trend over time">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.series} margin={{ top: 12, right: 4, left: -18, bottom: 0 }}>
                        <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#248f92" stopOpacity={0.28} /><stop offset="100%" stopColor="#248f92" stopOpacity={0.02} /></linearGradient></defs>
                        <CartesianGrid vertical={false} stroke="#8c9995" strokeOpacity={0.18} />
                        <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: "#76837f", fontSize: 10 }} />
                        <YAxis tickFormatter={(v) => value(Number(v), data.keyMetric.format)} tickLine={false} axisLine={false} width={58} tick={{ fill: "#76837f", fontSize: 9 }} />
                        <Tooltip formatter={(v) => [value(Number(v), data.keyMetric.format), data.keyMetric.format === "currency" ? "Amount" : "Records"]} />
                        <Area type="monotone" dataKey={data.keyMetric.format === "currency" ? "amount" : "count"} stroke="#248f92" strokeWidth={2.5} fill={`url(#${gradientId})`} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </NeuCard>
              )}
              {data.breakdown.length > 0 && (
                <NeuCard pressed className="insight-chart min-w-0 p-3 sm:p-4">
                  <div className="mb-2"><p className="text-xs font-bold text-[#3d5751]">Status / type mix</p><p className="text-[10px] text-[#75847f]">Distribution across all matching records</p></div>
                  <div className="h-[210px] w-full" role="img" aria-label="Operational records by status or type">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data.breakdown} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
                          {data.breakdown.map((item, index) => <Cell key={`${item.name}-${index}`} fill={colors[index % colors.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => number.format(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#697a75]">
                    {data.breakdown.map((item, index) => <span key={`${item.name}-legend`} className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />{item.name}: {number.format(item.value)}</span>)}
                  </div>
                </NeuCard>
              )}
            </div>
          )}
          {data.series.length === 0 && data.breakdown.length === 0 && (
            <NeuCard pressed className="p-4 text-sm text-[#657671]">No operational history is available for this view yet.</NeuCard>
          )}
        </>
      ) : null}
    </section>
  );
}

export default PageInsights;
