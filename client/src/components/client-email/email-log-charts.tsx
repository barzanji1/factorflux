import { useId } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, BarChart3, PieChart as PieChartIcon } from "lucide-react";
import { NeuCard } from "@/styles/neu";

export type EmailLogSummary = {
  totals: { sent: number; delivered: number; bounced: number; failed: number };
  weeks: { week: string; delivered: number; unsuccessful: number }[];
  entityTypes: { entityType: string | null; count: number }[];
};

const COLORS = ["#27aab8", "#55c5cf", "#849293", "#b4baba", "#168d98", "#707e80"];
const weekLabel = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
};

function CylinderBar(props: { x?: number; y?: number; width?: number; height?: number; value?: number; tone: "delivered" | "unsuccessful" }) {
  const unique = useId().replace(/:/g, "");
  const { x = 0, y = 0, width = 0, height = 0, tone } = props;
  if (height <= 0 || width <= 0 || (props.value !== undefined && props.value <= 0)) return null;
  const radius = Math.min(width / 2, 7);
  const fillId = `email-log-${tone}-${unique}-fill`;
  const capId = `email-log-${tone}-${unique}-cap`;
  const base = tone === "delivered" ? "#168d98" : "#a64f49";
  const highlight = tone === "delivered" ? "#55c3cb" : "#df8a7d";
  return <g aria-hidden="true">
    <defs>
      <linearGradient id={fillId} x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stopColor={tone === "delivered" ? "#148894" : "#9d4e48"} /><stop offset="48%" stopColor={highlight} /><stop offset="100%" stopColor={base} /></linearGradient>
      <linearGradient id={capId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={tone === "delivered" ? "#7ad9dc" : "#efaa9f"} /><stop offset="100%" stopColor={highlight} /></linearGradient>
    </defs>
    <rect x={x} y={y + radius} width={width} height={Math.max(0, height - radius)} fill={`url(#${fillId})`} />
    <ellipse cx={x + width / 2} cy={y + radius} rx={width / 2} ry={radius} fill={`url(#${capId})`} />
    <ellipse cx={x + width / 2} cy={y + height} rx={width / 2} ry={Math.max(1, radius * .52)} fill={base} opacity=".38" />
  </g>;
}

export function EmailLogCharts({ data, loading, error, onRetry, from, to }: {
  data?: EmailLogSummary;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  from: string;
  to: string;
}) {
  const weeks = data?.weeks ?? [];
  const entities = (data?.entityTypes ?? []).map((item) => ({
    name: item.entityType ? item.entityType.replace(/[_-]/g, " ") : "Unlinked",
    value: item.count,
  }));
  const empty = !loading && !error && !weeks.length && !entities.some((item) => item.value);
  return <div className="grid gap-4 lg:grid-cols-2" data-testid="email-log-charts">
    <NeuCard pressed className="min-w-0 p-4" data-testid="email-log-weekly-chart">
      <header className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e0e0e0] text-[#168f9b] shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#b8b8b8]"><BarChart3 size={17} /></span>
        <div><h2 className="text-sm font-bold text-[#354345]">Delivery Rate</h2><p className="text-[11px] text-[#737e80]">Weekly counts, not percentages · {from} to {to} · weeks labeled by Monday UTC</p></div>
      </header>
      <div className="mb-3 flex gap-4 text-[10px] font-semibold text-[#697477]"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#27aab8]" />Delivered</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#bd6258]" />Bounced + failed</span></div>
      {loading ? <div className="h-[220px] animate-pulse rounded-xl bg-[#d8d8d8]" aria-label="Loading weekly chart" />
        : error ? <div role="alert" className="grid min-h-[220px] place-items-center rounded-xl px-5 text-center text-xs text-[#a3483e]"><div><AlertTriangle className="mx-auto mb-2 h-5 w-5" /><p>Weekly delivery summary unavailable</p><button onClick={onRetry} className="mt-2 underline underline-offset-2">Retry</button></div></div>
          : weeks.length ? <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weeks} margin={{ top: 8, right: 6, bottom: 0, left: -20 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="#c7caca" strokeDasharray="3 5" />
              <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fill: "#7d8789", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "#7d8789", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip labelFormatter={(label) => `Week of ${weekLabel(String(label))}`} contentStyle={{ borderRadius: 12, border: "1px solid #d0d2d2", background: "#e0e0e0", boxShadow: "3px 3px 8px #b8b8b8" }} />
              <Bar dataKey="delivered" name="Delivered" shape={<CylinderBar tone="delivered" />} maxBarSize={32} isAnimationActive={false} />
              <Bar dataKey="unsuccessful" name="Bounced + failed" shape={<CylinderBar tone="unsuccessful" />} maxBarSize={32} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
            : <div className="grid h-[220px] place-items-center text-xs text-[#818b8d]">{empty ? "No email activity for this period" : "No weekly data in the selected range"}</div>}
    </NeuCard>
    <NeuCard pressed className="min-w-0 p-4" data-testid="email-log-entity-chart">
      <header className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e0e0e0] text-[#168f9b] shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#b8b8b8]"><PieChartIcon size={17} /></span>
        <div><h2 className="text-sm font-bold text-[#354345]">Volume by Type</h2><p className="text-[11px] text-[#737e80]">Messages in the selected range · {from} to {to}</p></div>
      </header>
      {loading ? <div className="mx-auto h-[190px] w-[190px] animate-pulse rounded-full bg-[#d8d8d8]" aria-label="Loading entity chart" />
        : error ? <div role="alert" className="grid min-h-[220px] place-items-center rounded-xl px-5 text-center text-xs text-[#a3483e]"><div><AlertTriangle className="mx-auto mb-2 h-5 w-5" /><p>Entity summary unavailable</p><button onClick={onRetry} className="mt-2 underline underline-offset-2">Retry</button></div></div>
          : entities.length && entities.some((item) => item.value) ? <div className="grid min-h-[220px] items-center gap-2 sm:grid-cols-[minmax(160px,1fr)_minmax(120px,.8fr)]">
            <ResponsiveContainer width="100%" height={210}>
              <PieChart><Pie data={entities} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={3} stroke="#e0e0e0" strokeWidth={3} isAnimationActive={false}>{entities.map((item, index) => <Cell key={`${item.name}-${index}`} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #d0d2d2", background: "#e0e0e0", boxShadow: "3px 3px 8px #b8b8b8" }} /></PieChart>
            </ResponsiveContainer>
            <ul className="space-y-2">{entities.map((item, index) => <li key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 text-[11px] capitalize text-[#626e70]"><span className="flex min-w-0 items-center gap-2"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} /><span className="truncate">{item.name}</span></span><strong className="font-mono text-[#394648]">{item.value.toLocaleString()}</strong></li>)}</ul>
          </div>
            : <div className="grid h-[220px] place-items-center text-xs text-[#818b8d]">{empty ? "No entity activity for this period" : "No entity data in the selected range"}</div>}
    </NeuCard>
  </div>;
}
