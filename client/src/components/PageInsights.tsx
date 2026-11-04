import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertCircle, RotateCcw } from "lucide-react";
import type { PageInsights as PageInsightsData, InsightEntity } from "@shared/page-insights";
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

type MetricFormat = "number" | "currency" | "days" | "hours" | "datetime" | "percent";
type ExtraMetric = { label: string; value: number; format: MetricFormat };
type InsightChartSeries = { key: string; label: string; color: string; format?: "number" | "currency" | "percent" };
type InsightChart = {
  title: string;
  kind: "cylinder" | "donut" | "area";
  data: Array<Record<string, string | number>>;
  series: InsightChartSeries[];
  xKey?: string;
};
type ExtendedInsights = PageInsightsData & {
  extraMetrics?: ExtraMetric[];
  totalLabel?: string;
  seriesLabel?: string;
  breakdownLabel?: string;
  charts?: InsightChart[];
};

const colors = ["#1f9299", "#e0a44d", "#718b83", "#bc7462", "#8297a0"];
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat();
const entityLabels: Partial<Record<InsightEntity | "loads", { total: string; series: string; breakdown: string; totalDetail: string }>> = {
  "client-email": { total: "Messages sent", series: "Email volume", breakdown: "Messages by type", totalDetail: "Outbound client communications" },
  "cash-application": { total: "Cash applications", series: "Applied payment volume", breakdown: "Application status mix", totalDetail: "Recorded remittance applications" },
  factoring: { total: "Invoices in factoring", series: "Invoice flow", breakdown: "Invoice status mix", totalDetail: "Factoring pipeline" },
  sheets: { total: "Funding queue items", series: "Funding volume", breakdown: "Queue status mix", totalDetail: "Ready and in-review sheets" },
  payouts: { total: "Payment records", series: "Payment volume", breakdown: "Payment status mix", totalDetail: "Recorded carrier payments" },
  lockbox: { total: "Lockbox entries", series: "Lockbox volume", breakdown: "Match status mix", totalDetail: "Incoming payment records" },
  "fuel-advance": { total: "Fuel advances", series: "Advance volume", breakdown: "Advance status mix", totalDetail: "Fuel advance ledger" },
  "bank-transfers": { total: "Bank transfers", series: "Transfer volume", breakdown: "Transfer status mix", totalDetail: "Recorded transfers" },
  dispatchers: { total: "Dispatchers", series: "Dispatcher activity", breakdown: "Dispatcher status mix", totalDetail: "Dispatcher roster" },
  trucks: { total: "Trucks", series: "Fleet activity", breakdown: "Fleet status mix", totalDetail: "Registered trucks" },
  "release-letters": { total: "Release letters", series: "Letters generated", breakdown: "Letter type mix", totalDetail: "Generated carrier letters" },
  "credit-checks": { total: "Credit reviews", series: "Review volume", breakdown: "Review outcomes", totalDetail: "Broker credit reviews" },
  "fmcsa-authority": { total: "Authority checks", series: "Check activity", breakdown: "Authority status mix", totalDetail: "Carrier authority monitoring" },
  held: { total: "Held invoices", series: "Hold activity", breakdown: "Hold reason mix", totalDetail: "Invoices currently held or reviewed" },
  "audit-log": { total: "Audit events", series: "Events by day", breakdown: "Actions by type", totalDetail: "Recorded system and user activity" },
  followups: { total: "Follow-up items", series: "Follow-up trend", breakdown: "Work type mix", totalDetail: "Manual tasks and broker automations" },
  reports: { total: "Report records", series: "Reported activity", breakdown: "Portfolio mix", totalDetail: "Records represented in this report" },
  admin: { total: "Administrative records", series: "Team activity", breakdown: "Activity by section", totalDetail: "Current administrative view" },
  payroll: { total: "Payroll entries", series: "Payroll by period", breakdown: "Payroll composition", totalDetail: "Recorded payroll activity" },
  expenses: { total: "Expense entries", series: "Monthly spend", breakdown: "Expenses by category", totalDetail: "Submitted and approved expenses" },
  vault: { total: "Vault documents", series: "Document activity", breakdown: "Documents by category", totalDetail: "Selected carrier documents" },
  "document-rules": { total: "Document rules", series: "Rule activity", breakdown: "Rules by status", totalDetail: "Configured document requirements" },
  "workflow-builder": { total: "Workflow stages", series: "Workflow activity", breakdown: "Stages by status", totalDetail: "Configured workflow stages" },
  collections: { total: "Collection items", series: "Collection activity", breakdown: "Collection status mix", totalDetail: "Open recovery work" },
  brokers: { total: "Broker records", series: "Broker activity", breakdown: "Broker status mix", totalDetail: "Broker portfolio" },
};

function InsightCylinderBar(props: { x?: number; y?: number; width?: number; height?: number; fill?: string; value?: number }) {
  const id = `insight-cylinder-${useId().replace(/:/g, "")}`;
  const { x = 0, y = 0, width = 0, height = 0, fill = "#168d99" } = props;
  if (height <= 0 || width <= 0 || (props.value !== undefined && props.value <= 0)) return null;
  const radius = Math.min(width / 2, 7);
  return <g aria-hidden="true">
    <defs><linearGradient id={id} x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stopColor={fill} /><stop offset="48%" stopColor={fill} stopOpacity=".65" /><stop offset="100%" stopColor={fill} /></linearGradient></defs>
    <rect x={x} y={y + radius} width={width} height={Math.max(0, height - radius)} fill={`url(#${id})`} />
    <ellipse cx={x + width / 2} cy={y + radius} rx={width / 2} ry={radius} fill={fill} opacity=".72" />
    <ellipse cx={x + width / 2} cy={y + height} rx={width / 2} ry={Math.max(1, radius * .52)} fill={fill} opacity=".38" />
  </g>;
}

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
  const data = query.data as ExtendedInsights | undefined;
  const labels = entityLabels[entity] ?? { total: "Operational items", series: "Activity by period", breakdown: "Records by status", totalDetail: "Records in this operational view" };
  const value = (amount: number, format: "number" | "currency") =>
    format === "currency" ? money.format(amount) : number.format(amount);
  const metricValue = (metric: ExtraMetric) => {
    if (metric.format === "datetime") return metric.value === 0 ? "No run recorded" : new Date(metric.value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    if (metric.format === "currency") return money.format(metric.value);
    if (metric.format === "percent") return `${number.format(metric.value)}%`;
    if (metric.format === "days") return `${number.format(metric.value)} days`;
    if (metric.format === "hours") return `${number.format(metric.value)} hrs`;
    return number.format(metric.value);
  };
  const chartValue = (amount: number, format: InsightChartSeries["format"] = "number") =>
    format === "currency" ? money.format(amount) : format === "percent" ? `${number.format(amount)}%` : number.format(amount);

  return (
    <section className="mb-5 space-y-3" aria-label={`${title} insights`} data-insights-entity={entity}>
      <div className="flex items-end justify-between gap-3">
        <div>
          {entity !== "client-email" && <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#63807a]">Full {labels.total.toLowerCase()} · refreshes every minute</p>}
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
          {data.extraMetrics !== undefined ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {data.extraMetrics.map((metric) => <NeuStatCard key={metric.label} label={metric.label} value={<span className="insight-number">{metricValue(metric)}</span>} className="insight-stat min-h-[88px] p-3" />)}
            </div>
          ) : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <NeuStatCard label={data.totalLabel ?? labels.total} value={<span className="insight-number">{number.format(data.total)}</span>} detail={labels.totalDetail} className="insight-stat min-h-[88px] p-3" />
            <NeuStatCard label={data.openLabel ?? "Open items"} value={<span className="insight-number">{number.format(data.open)}</span>} detail={`Open ${labels.total.toLowerCase()}`} className="insight-stat min-h-[88px] p-3" />
            <NeuStatCard label={data.keyMetric.label} value={<span className="insight-number">{value(data.keyMetric.value, data.keyMetric.format)}</span>} detail={data.keyMetric.format === "currency" ? "Recorded value" : "Recorded activity"} className="insight-stat min-h-[88px] p-3" />
          </div>}
          {data.charts !== undefined ? data.charts.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {data.charts.map((chart, chartIndex) => {
                const chartId = `${gradientId}-custom-${chartIndex}`;
                const xKey = chart.xKey ?? "name";
                const firstSeries = chart.series[0];
                return <NeuCard key={`${chart.title}-${chartIndex}`} pressed className="insight-chart min-w-0 p-3 sm:p-4">
                  <div className="mb-2"><p className="text-xs font-bold text-[#3d5751]">{chart.title}</p><p className="text-[10px] text-[#75847f]">{chart.kind === "donut" ? "Distribution across matching records" : "Full-dataset trend by period"}</p></div>
                  <div className="h-[210px] w-full" role="img" aria-label={chart.title}>
                    <ResponsiveContainer width="100%" height="100%">
                      {chart.kind === "donut" ? <PieChart>
                        <Pie data={chart.data} dataKey={firstSeries?.key ?? "value"} nameKey={xKey} innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
                          {chart.data.map((item, index) => <Cell key={`${String(item[xKey] ?? index)}-${index}`} fill={chart.series[index]?.color ?? colors[index % colors.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v, _name, item) => [chartValue(Number(v), firstSeries?.format), String(item?.payload?.[xKey] ?? firstSeries?.label ?? "Records")]} />
                      </PieChart> : chart.kind === "area" ? <AreaChart data={chart.data} margin={{ top: 12, right: 4, left: -18, bottom: 0 }}>
                        <defs>{chart.series.map((series, index) => <linearGradient key={series.key} id={`${chartId}-${index}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={series.color} stopOpacity={0.28} /><stop offset="100%" stopColor={series.color} stopOpacity={0.02} /></linearGradient>)}</defs>
                        <CartesianGrid vertical={false} stroke="#8c9995" strokeOpacity={0.18} />
                        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fill: "#76837f", fontSize: 10 }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fill: "#76837f", fontSize: 9 }} />
                        <Tooltip formatter={(v, name) => { const series = chart.series.find(item => item.key === name); return [chartValue(Number(v), series?.format), series?.label ?? String(name)]; }} />
                        {chart.series.map((series, index) => <Area key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={series.color} strokeWidth={2.5} fill={`url(#${chartId}-${index})`} />)}
                      </AreaChart> : <BarChart data={chart.data} margin={{ top: 12, right: 4, left: -18, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="#8c9995" strokeOpacity={0.18} />
                        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fill: "#76837f", fontSize: 10 }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fill: "#76837f", fontSize: 9 }} />
                        <Tooltip formatter={(v, name) => { const series = chart.series.find(item => item.key === name); return [chartValue(Number(v), series?.format), series?.label ?? String(name)]; }} />
                        {chart.series.map(series => <Bar key={series.key} dataKey={series.key} name={series.label} shape={<InsightCylinderBar fill={series.color} />} maxBarSize={25} />)}
                      </BarChart>}
                    </ResponsiveContainer>
                  </div>
                  {chart.kind === "donut" && <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#697a75]">{chart.data.map((item, index) => <span key={`${String(item[xKey] ?? index)}-legend`} className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: chart.series[index]?.color ?? colors[index % colors.length] }} />{String(item[xKey] ?? "Item")}: {chartValue(Number(item[firstSeries?.key ?? "value"] ?? 0), firstSeries?.format)}</span>)}</div>}
                </NeuCard>;
              })}
            </div>
          ) : <NeuCard pressed className="p-4 text-sm text-[#657671]">No operational charts are available for this view yet.</NeuCard> : (data.series.length > 0 || data.breakdown.length > 0) && (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {data.series.length > 0 && (
                <NeuCard pressed className="insight-chart min-w-0 p-3 sm:p-4">
                  <div className="mb-2"><p className="text-xs font-bold text-[#3d5751]">{data.seriesLabel ?? labels.series}</p><p className="text-[10px] text-[#75847f]">Full dataset by period</p></div>
                  <div className="h-[210px] w-full" role="img" aria-label="Activity and amount over time">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.series} margin={{ top: 12, right: 4, left: -18, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="#8c9995" strokeOpacity={0.18} />
                        <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: "#76837f", fontSize: 10 }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fill: "#76837f", fontSize: 9 }} />
                        <Tooltip formatter={(v, name) => [name === "amount" ? money.format(Number(v)) : number.format(Number(v)), name === "amount" ? "Amount" : "Records"]} />
                        <Bar dataKey="count" shape={<InsightCylinderBar />} maxBarSize={25} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </NeuCard>
              )}
              {data.series.length > 0 && (
                <NeuCard pressed className="insight-chart min-w-0 p-3 sm:p-4">
                  <div className="mb-2"><p className="text-xs font-bold text-[#3d5751]">{data.seriesLabel ?? labels.series} trend</p><p className="text-[10px] text-[#75847f]">Full-dataset trend by period</p></div>
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
                  <div className="mb-2"><p className="text-xs font-bold text-[#3d5751]">{data.breakdownLabel ?? labels.breakdown}</p><p className="text-[10px] text-[#75847f]">Distribution across matching records</p></div>
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
          {data.charts === undefined && data.series.length === 0 && data.breakdown.length === 0 && (
            <NeuCard pressed className="p-4 text-sm text-[#657671]">No operational history is available for this view yet.</NeuCard>
          )}
        </>
      ) : null}
    </section>
  );
}

export default PageInsights;
