import { useId, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NeuButton, NeuCard, NeuStatCard } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { CylinderBar } from "@/components/dashboard/FinancialOverview";
import type { DocumentStats } from "@shared/document-analytics";

const statusColors = { processed: "#27aab8", pending: "#9ba3a5", failed: "#c56a65", processing: "#d4ad48" };
const monthLabel = (value: string) => new Date(`${value}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
function ChartCard({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return <NeuCard pressed className="min-w-0 p-4 sm:p-5">
    <h3 className="text-sm font-semibold text-[#333]">{title}</h3>
    <p className="mb-4 mt-2 text-xs text-[#888]">{note}</p>{children}
  </NeuCard>;
}
function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="flex h-52 items-center justify-center text-center text-sm text-[#888]">{children}</div>;
}
function CylinderChart({ rows, description }: { rows: { label: string; count: number; fullLabel?: string }[]; description: string }) {
  return <div className="h-52 min-w-0" role="img" aria-label={description}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ left: -20, top: 12, right: 8 }}>
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} interval={0} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
        <Tooltip formatter={value => [Number(value), "Documents"]} labelFormatter={(_label, payload) => payload[0]?.payload?.fullLabel ?? _label} />
        <Bar dataKey="count" shape={<CylinderBar />} maxBarSize={34} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
export function DocumentsOverview() {
  const gradientId = `document-confidence-${useId().replace(/:/g, "")}`;
  const query = useQuery<DocumentStats>({
    queryKey: ["/api/documents", "stats"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/documents/stats", { credentials: "include", signal });
      if (!response.ok) throw new Error("Unable to load document statistics");
      return response.json();
    },
    staleTime: 60_000, refetchOnMount: "always", refetchInterval: 30_000,
  });
  if (query.isLoading) return <section aria-label="Loading document statistics" aria-busy="true" className="space-y-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <NeuCard key={index} className="h-28 animate-pulse bg-[#d6d6d6]" />)}</div>
    <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <NeuCard pressed key={index} className="h-72 animate-pulse" />)}</div>
  </section>;
  if (query.error || !query.data) return <NeuNotice severity="block" role="alert">
    <p className="text-sm">Unable to load document statistics.</p><NeuButton className="mt-3" onClick={() => void query.refetch()}>Retry</NeuButton>
  </NeuNotice>;
  const data = query.data;
  const stat = (label: string, value: string | number, detail: string) => <NeuStatCard key={label} label={label}
    value={<span className="text-[#27aab8]">{value}</span>} detail={detail} className="min-h-28 min-w-0 p-4 [&_p.text-3xl]:text-2xl" />;
  const typeRows = data.types.map(row => ({
    label: ({ rate_confirmation: "Rate con", freight_invoice: "Freight inv", bol_pod: "BOL/POD", noa: "NOA", other: "Other" } as Record<string, string>)[row.type],
    fullLabel: row.label, count: row.count,
  }));
  const uploadRows = data.uploads.map(row => ({ label: monthLabel(row.month), count: row.count }));
  return <section aria-label="Document statistics" className="space-y-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
      {stat("Total Documents", data.total, "All documents you can access")}
      {stat("Pending Review", data.pendingReview, "Not yet confirmed by a reviewer")}
      {stat("Processed", data.processed, "Latest processing state")}
      {stat("Failed OCR", data.failedOcr, "Latest extraction/document failed")}
      {stat("Avg Confidence", data.averageConfidence === null ? "—" : `${data.averageConfidence}%`, "Recorded OCR confidence only")}
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Documents by Type" note="Final human classification takes priority · legacy aliases grouped">
        {data.total ? <CylinderChart rows={typeRows} description={data.types.map(row => `${row.label}: ${row.count}`).join("; ")} /> : <EmptyChart>No documents yet.</EmptyChart>}
      </ChartCard>
      <ChartCard title="OCR Confidence Distribution" note={`Completed extraction confidence · ${data.unknownConfidence} unavailable · bucket upper bounds exclusive, except 100%`}>
        {data.confidence.some(row => row.count > 0) ? <div className="h-52 min-w-0" role="img" aria-label={data.confidence.map(row => `${row.bucket}: ${row.count} documents`).join("; ")}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.confidence} margin={{ left: -20, top: 12, right: 8 }}>
              <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#27aab8" stopOpacity={0.5} /><stop offset="100%" stopColor="#27aab8" stopOpacity={0.03} /></linearGradient></defs>
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={value => [Number(value), "Documents"]} />
              <Area type="linear" dataKey="count" stroke="#27aab8" strokeWidth={2} fill={`url(#${gradientId})`} dot={{ r: 3 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div> : <EmptyChart>No completed OCR confidence recorded.</EmptyChart>}
      </ChartCard>
      <ChartCard title="Upload Volume" note="Documents uploaded per month · last six months · America/Denver">
        {uploadRows.some(row => row.count > 0) ? <CylinderChart rows={uploadRows} description={uploadRows.map(row => `${row.label}: ${row.count} uploads`).join("; ")} /> : <EmptyChart>No uploads in the last six months.</EmptyChart>}
      </ChartCard>
      <ChartCard title="Processing Status" note="Latest extraction job takes priority over an older document status">
        {data.total ? <>
          <div className="relative h-44 min-w-0" role="img" aria-label={data.statuses.map(row => `${row.label}: ${row.count}`).join("; ")}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={data.statuses.filter(row => row.count > 0)} dataKey="count" nameKey="label" innerRadius="60%" outerRadius="85%" stroke="none" isAnimationActive={false}>
                {data.statuses.filter(row => row.count > 0).map(row => <Cell key={row.status} fill={statusColors[row.status]} />)}
              </Pie><Tooltip formatter={value => [Number(value), "Documents"]} /></PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-xs text-[#888]">Total</span><strong className="text-2xl text-[#168894]">{data.total}</strong></div>
          </div>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-[#666]">
            {data.statuses.map(row => <span key={row.status} className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: statusColors[row.status] }} />{row.label}: {row.count}</span>)}
          </div>
        </> : <EmptyChart>No documents yet.</EmptyChart>}
      </ChartCard>
    </div>
  </section>;
}
