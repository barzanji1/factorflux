import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, CircleDollarSign, ClipboardCheck, Clock3, RotateCcw, TrendingUp, WalletCards } from "lucide-react";
import { NeuBadge, NeuButton, NeuCard, NeuStatCard } from "@/styles/neu";
import { KpiCarousel } from "./KpiCarousel";

export type FinancialDashboardData = {
  generatedAt: string;
  viewer: { id: string; role: string };
  kpis: {
    readyToFund: number;
    inReview: number;
    openFollowups: number;
    aging60Plus: number;
    fundedThisWeek: number;
    pendingActions: number;
  };
  months: Array<{ month: string; invoiced: number; collected: number }>;
};

type Props = {
  data?: FinancialDashboardData;
  isLoading: boolean;
  error?: unknown;
  onRetry: () => void;
};

type WorkShortcutsProps = {
  followupCount?: number;
  onViewFollowups: () => void;
  pendingActions?: number;
  onViewActions: () => void;
};

const currency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const compactCurrency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function shortMonth(value: string) {
  const [year, month] = value.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function CylinderBar(props: { x?: number; y?: number; width?: number; height?: number; fill?: string; value?: number }) {
  const { x = 0, y = 0, width = 0, height = 0 } = props;
  if (height <= 0 || width <= 0 || (props.value !== undefined && props.value <= 0)) return null;
  const radius = Math.min(width / 2, 8);
  const colorId = "collections-cylinder-gradient";
  return (
    <g aria-hidden="true">
      <defs>
        <linearGradient id={colorId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#168a91" />
          <stop offset="42%" stopColor="#4fd1c5" />
          <stop offset="75%" stopColor="#27aab8" />
          <stop offset="100%" stopColor="#147d86" />
        </linearGradient>
        <linearGradient id="collections-cylinder-cap" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#79e0d4" />
          <stop offset="100%" stopColor="#2cb8b5" />
        </linearGradient>
      </defs>
      <rect x={x} y={y + radius} width={width} height={Math.max(0, height - radius)} fill={`url(#${colorId})`} />
      <ellipse cx={x + width / 2} cy={y + radius} rx={width / 2} ry={radius} fill="url(#collections-cylinder-cap)" />
      <ellipse cx={x + width / 2} cy={y + height} rx={width / 2} ry={Math.max(1, radius * 0.52)} fill="#167f86" opacity="0.38" />
    </g>
  );
}

function ChartSkeleton() {
  return <div className="ff-neu-chart-skeleton" aria-label="Loading financial chart"><span /><span /><span /><span /><span /></div>;
}

function FinancialCharts({ months }: { months: FinancialDashboardData["months"] }) {
  const plotData = useMemo(() => months.map(point => ({ ...point, label: shortMonth(point.month) })), [months]);
  const hasValues = plotData.length > 0;
  return (
    <section className="mt-7" aria-labelledby="financial-overview-heading" data-testid="financial-overview">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="ff-neu-eyebrow">Capital in motion</p>
          <h2 id="financial-overview-heading" className="ff-neu-section-title">Financial Overview</h2>
        </div>
        {hasValues && <NeuBadge tone="accent" className="hidden sm:inline-flex">{plotData.length} months</NeuBadge>}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_1.15fr]">
        <NeuCard pressed className="ff-neu-chart-card">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div><p className="ff-neu-card-kicker">Monthly Collections</p><p className="ff-neu-chart-caption">Collected invoice value</p></div>
            <span className="ff-neu-chart-mark"><CircleDollarSign aria-hidden="true" /></span>
          </div>
          {hasValues ? (
            <div className="h-[250px] w-full" role="img" aria-label="Monthly collected amounts shown as a bar chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={plotData} margin={{ top: 18, right: 4, left: 0, bottom: 2 }}>
                  <CartesianGrid vertical={false} stroke="#8c9995" strokeOpacity={0.18} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#888", fontSize: 11 }} dy={8} />
                  <YAxis tickFormatter={value => compactCurrency.format(Number(value))} tickLine={false} axisLine={false} width={54} tick={{ fill: "#888", fontSize: 10 }} />
                  <Tooltip
                    cursor={{ fill: "#27aab8", opacity: 0.08 }}
                    formatter={value => [currency.format(Number(value)), "Collected"]}
                    labelStyle={{ color: "#55615d", fontWeight: 700 }}
                    contentStyle={{ border: 0, borderRadius: 12, background: "#e0e0e0", boxShadow: "4px 4px 9px #c1c1c1, -4px -4px 9px #fff" }}
                  />
                  <Bar dataKey="collected" shape={<CylinderBar />} maxBarSize={34} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="ff-neu-chart-empty">No monthly collections to display yet.</p>}
        </NeuCard>
        <NeuCard pressed className="ff-neu-chart-card">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div><p className="ff-neu-card-kicker">Invoiced vs Collected</p><p className="ff-neu-chart-caption">Monthly volume, side by side</p></div>
            <div className="flex items-center gap-3 pt-1 text-[10px] font-semibold text-[#7b8783]">
              <span className="flex items-center gap-1.5"><i className="ff-neu-legend-dot invoiced" />Invoiced</span>
              <span className="flex items-center gap-1.5"><i className="ff-neu-legend-dot collected" />Collected</span>
            </div>
          </div>
          {hasValues ? (
            <div className="h-[250px] w-full" role="img" aria-label="Monthly invoiced and collected amounts shown as area lines">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={plotData} margin={{ top: 12, right: 4, left: 0, bottom: 2 }}>
                  <defs>
                    <linearGradient id="invoiced-area-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#27aab8" stopOpacity={0.26} />
                      <stop offset="95%" stopColor="#27aab8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="collected-area-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#4fd1c5" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#4fd1c5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#8c9995" strokeOpacity={0.18} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#888", fontSize: 11 }} dy={8} />
                  <YAxis tickFormatter={value => compactCurrency.format(Number(value))} tickLine={false} axisLine={false} width={54} tick={{ fill: "#888", fontSize: 10 }} />
                  <Tooltip
                    formatter={(value, name) => [currency.format(Number(value)), name === "invoiced" ? "Invoiced" : "Collected"]}
                    labelStyle={{ color: "#55615d", fontWeight: 700 }}
                    contentStyle={{ border: 0, borderRadius: 12, background: "#e0e0e0", boxShadow: "4px 4px 9px #c1c1c1, -4px -4px 9px #fff" }}
                  />
                  <Area type="monotone" dataKey="invoiced" stroke="#27aab8" strokeWidth={2.5} fill="url(#invoiced-area-fill)" />
                  <Area type="monotone" dataKey="collected" stroke="#4fd1c5" strokeWidth={2.5} fill="url(#collected-area-fill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="ff-neu-chart-empty">No monthly financial history to display yet.</p>}
        </NeuCard>
      </div>
    </section>
  );
}

function FinancialChartsLoading() {
  return (
    <section className="mt-7" aria-labelledby="financial-overview-heading" data-testid="financial-overview-loading" aria-label="Loading financial overview">
      <div className="mb-4">
        <p className="ff-neu-eyebrow">Capital in motion</p>
        <h2 id="financial-overview-heading" className="ff-neu-section-title">Financial Overview</h2>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_1.15fr]">
        <NeuCard pressed className="ff-neu-chart-card"><ChartSkeleton /></NeuCard>
        <NeuCard pressed className="ff-neu-chart-card"><ChartSkeleton /></NeuCard>
      </div>
    </section>
  );
}

const metrics = [
  { key: "readyToFund", label: "Ready to Fund", href: "/sheets", icon: WalletCards, money: true },
  { key: "inReview", label: "In Review", href: "/invoices?status=under_review", icon: ClipboardCheck },
  { key: "openFollowups", label: "Open Follow-ups", href: "/follow-up", icon: RotateCcw },
  { key: "aging60Plus", label: "Aging 60+", href: "/reports?tab=aging", icon: Clock3 },
  { key: "fundedThisWeek", label: "Funded This Week", href: "/invoices?status=funded", icon: TrendingUp, money: true },
] as const;

function MetricSkeleton() {
  return <div className="ff-neu-metric-skeleton" aria-hidden="true"><span /><span /><span /></div>;
}

export function FinancialSummary({ data, isLoading, error, onRetry }: Props) {
  const metricCards = data ? metrics.map(metric => {
    const Icon = metric.icon;
    const value = data.kpis[metric.key];
    const isMoney = "money" in metric && metric.money;
    return (
      {
        key: metric.key,
        href: metric.href,
        label: metric.label,
        content: <NeuStatCard
          label={metric.label}
          value={isMoney ? currency.format(value) : value.toLocaleString()}
          detail={isMoney ? "USD" : "Open work"}
          icon={<Icon aria-hidden="true" className="h-5 w-5" />}
          className="ff-neu-kpi-card"
        />
      }
    );
  }) : null;

  return (
    <>
      <div className="ff-neu-dashboard-intro">
        <div>
          <p className="ff-neu-eyebrow">Trucking Pros Financial · Work Queue</p>
          <h1 className="ff-neu-page-title">Good work moves forward.</h1>
          <p className="ff-neu-page-subtitle">A clear view of what is ready, waiting, and getting older.</p>
        </div>
        <div className="ff-neu-intro-mark" aria-hidden="true"><span>FF</span><i /></div>
      </div>
      <section aria-label="Financial key performance indicators" className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="ff-neu-eyebrow">At a glance</span>
            {data && <span className="ff-neu-live-dot" aria-label="Live data" />}
          </div>
        </div>
        {isLoading ? <div className="ff-neu-metrics-viewport"><div className="ff-neu-metrics-track">{metrics.map(metric => <MetricSkeleton key={metric.key} />)}</div></div> :
          error ? <div className="ff-neu-financial-error" role="alert"><span>Financial summary could not be loaded.</span><NeuButton onClick={onRetry} className="!min-h-9 !px-3"><RotateCcw className="h-4 w-4" /> Retry</NeuButton></div> :
          data && metricCards ? <KpiCarousel items={metricCards} speedPixelsPerSecond={30} /> : null}
      </section>
      {isLoading && <FinancialChartsLoading />}
      {data && <FinancialCharts months={data.months} />}
      {error && !isLoading && <section className="mt-7" role="status"><p className="ff-neu-eyebrow">Financial Overview</p><p className="mt-2 text-sm text-[#8a6558]">Financial charts are unavailable until the summary can be loaded.</p></section>}
    </>
  );
}

export function WorkShortcuts({ followupCount, onViewFollowups, pendingActions, onViewActions }: WorkShortcutsProps) {
  return (
    <section className="mt-7 grid gap-4 sm:grid-cols-2" aria-label="Work shortcuts" data-testid="work-shortcuts">
      <NeuCard className="ff-neu-bottom-card">
        <div className="ff-neu-bottom-icon"><RotateCcw aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <p className="ff-neu-card-kicker">Upcoming Follow-ups</p>
          <p className="ff-neu-bottom-count">{followupCount?.toLocaleString() ?? "—"}</p>
        </div>
        <NeuButton onClick={onViewFollowups} className="ff-neu-link-button">View all <ArrowRight aria-hidden="true" /></NeuButton>
      </NeuCard>
      <NeuCard className="ff-neu-bottom-card">
        <div className="ff-neu-bottom-icon actions"><ClipboardCheck aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <p className="ff-neu-card-kicker">Pending Actions</p>
          <p className="ff-neu-bottom-count">{pendingActions?.toLocaleString() ?? "—"}</p>
        </div>
        <NeuButton onClick={onViewActions} className="ff-neu-link-button">View all <ArrowRight aria-hidden="true" /></NeuButton>
      </NeuCard>
    </section>
  );
}
