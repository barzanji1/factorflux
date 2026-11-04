import { useId } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NeuButton, NeuCard, NeuStatCard } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { buildTaskStats, type TaskAnalyticsRow } from "@shared/task-analytics";

function TaskCylinder({ x = 0, y = 0, width = 0, height = 0, fill = "#27aab8" }: { x?: number; y?: number; width?: number; height?: number; fill?: string }) {
  const id = `task-cylinder-${useId().replace(/:/g, "")}`;
  if (height <= 0 || width <= 0) return null;
  const radius = Math.min(5, width / 5, height / 3);
  const gray = fill === "#9aa7aa";
  return <g>
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor={gray ? "#7d898c" : "#16818c"} />
      <stop offset="38%" stopColor={gray ? "#d5dcdd" : "#77d9de"} />
      <stop offset="100%" stopColor={fill} />
    </linearGradient></defs>
    <rect x={x} y={y + radius} width={width} height={Math.max(0, height - radius)} fill={`url(#${id})`} />
    <ellipse cx={x + width / 2} cy={y + height} rx={width / 2} ry={radius} fill={gray ? "#7d898c" : "#16818c"} />
    <ellipse cx={x + width / 2} cy={y + radius} rx={width / 2} ry={radius} fill={gray ? "#c3cdcf" : "#70d3d9"} />
  </g>;
}
const weekLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const palette = ["#17838c", "#51c3cf", "#a4b8b9", "#879496"];
export function TasksOverview({ tasks, isLoading, isError, onRetry }: {
  tasks: TaskAnalyticsRow[]; isLoading?: boolean; isError?: boolean; onRetry?: () => void;
}) {
  if (isLoading) return <section aria-label="Loading task statistics" aria-busy="true" className="space-y-5">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <NeuCard key={index} className="h-28 animate-pulse" />)}</div>
    <div className="grid gap-5 lg:grid-cols-2"><NeuCard pressed className="h-80 animate-pulse" /><NeuCard pressed className="h-80 animate-pulse" /></div>
  </section>;
  if (isError) return <NeuNotice severity="block" role="alert">
    <p className="text-sm">Task statistics could not be loaded.</p>
    <NeuButton className="mt-3" onClick={onRetry}>Retry</NeuButton>
  </NeuNotice>;
  const stats = buildTaskStats(tasks);
  return <section aria-label="Task statistics" className="space-y-5">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
      {[
        ["Total Tasks", stats.total, "Current task scope"],
        ["Open", stats.open, "All unfinished, including held"],
        ["In Progress", stats.inProgress, "Currently being worked"],
        ["Completed Today", stats.completedToday, "Completed · last updated today"],
        ["Overdue", stats.overdue, "Unfinished · due before today"],
      ].map(([label, value, detail]) => <NeuStatCard key={label} label={String(label)} detail={String(detail)}
        value={<span className={label === "Overdue" && stats.overdue > 0 ? "text-red-700" : "text-[#27aab8]"}>{value}</span>}
        className="min-w-0 p-4 [&_p.text-3xl]:text-2xl" />)}
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <NeuCard pressed className="min-w-0 p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-[#333]">Task Completion Rate</h3>
        <p className="mb-3 mt-2 text-xs leading-relaxed text-[#888]">Created vs completed · 8 Monday-based weeks, including this week · America/Denver</p>
        {stats.weeks.some(row => row.created || row.completed) ? <div className="h-52 min-w-0" role="img"
          aria-label={stats.weeks.map(row => `${weekLabel(row.week)}: ${row.created} created, ${row.completed} completed`).join("; ")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.weeks} margin={{ left: -20, top: 12, right: 8 }} barGap={3}>
              <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <Tooltip labelFormatter={value => `Week of ${weekLabel(String(value))}`} />
              <Bar dataKey="created" name="Created" fill="#9aa7aa" maxBarSize={22} shape={<TaskCylinder fill="#9aa7aa" />} isAnimationActive={false} />
              <Bar dataKey="completed" name="Completed" fill="#27aab8" maxBarSize={22} shape={<TaskCylinder fill="#27aab8" />} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div> : <div className="flex h-52 items-center justify-center text-sm text-[#888]">No task activity in the last eight weeks.</div>}
        <div className="mt-2 flex justify-center gap-4 text-xs text-[#666]">
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#27aab8]" />Completed</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#9aa7aa]" />Created</span>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[#888]">Completion dates are not recorded separately. Completed counts use each completed task’s last update time.{stats.unknownCompletionDate > 0 ? ` ${stats.unknownCompletionDate} completed task(s) have no usable timestamp and are excluded from the completion series.` : ""}</p>
      </NeuCard>
      <NeuCard pressed className="min-w-0 p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-[#333]">Tasks by Priority</h3>
        <p className="mb-3 mt-2 text-xs leading-relaxed text-[#888]">Unfinished tasks only · urgent grouped with high priority</p>
        {stats.open > 0 ? <>
          <div className="relative h-52 min-w-0" role="img" aria-label={stats.priorities.map(row => `${row.label}: ${row.count}`).join("; ")}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={stats.priorities.filter(row => row.count > 0)} dataKey="count" nameKey="label"
                innerRadius="60%" outerRadius="85%" stroke="none" isAnimationActive={false}>
                {stats.priorities.filter(row => row.count > 0).map(row => <Cell key={row.priority} fill={palette[stats.priorities.indexOf(row)]} />)}
              </Pie><Tooltip formatter={value => [Number(value), "Open tasks"]} /></PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-xs text-[#888]">Total open</span><strong className="text-2xl text-[#168894]">{stats.open}</strong></div>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-[#666]">
            {stats.priorities.map((row, index) => <span key={row.priority} className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: palette[index] }} />{row.label}: {row.count}</span>)}
          </div>
        </> : <div className="flex h-52 flex-col items-center justify-center gap-2 text-[#888]"><strong className="text-2xl text-[#27aab8]">0</strong><span className="text-sm">No open tasks.</span></div>}
      </NeuCard>
    </div>
  </section>;
}
