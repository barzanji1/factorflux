import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/layout/AppShell";
import { SystemHealthCard } from "@/components/dashboard/SystemHealthCard";
import type { SystemHealthStatus } from "@/components/dashboard/SystemHealthCard";
import { Win95Button } from "@/components/win95";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, ArrowUpRight, BriefcaseBusiness, Clock3, RefreshCw } from "lucide-react";

type QueueItem = {
  id: number;
  invoiceNumber: string;
  carrierName: string;
  brokerName: string;
  status: string;
  ageDays: number | null;
  ageBasis: string;
  actions: string[];
  href: string;
};
type QueueGroup = { agentId: string | null; agentName: string; items: QueueItem[] };
type FollowUp = {
  id: string; source: string; title: string; carrierName: string | null; status: string;
  priority: string; dueDate: string | null; href: string;
};
type Activity = { id: number; who: string; action: string; when: string | null; href: string | null };
type Alert = { id: string; kind: string; title: string; detail: string; when: string | null; href: string };
type DashboardData = {
  generatedAt: string;
  viewer: { id: string; role: string };
  queueGroups: QueueGroup[];
  followUps: FollowUp[];
  activity: Activity[];
  alerts: Alert[];
  alertCounts: { email_bounced: number; ocr_failed: number; unverified_carrier: number };
  systemHealth: { fmcsaAuthority: SystemHealthStatus };
};

const countKinds = [
  ["email_bounced", "Bounced email"],
  ["ocr_failed", "OCR failures"],
  ["unverified_carrier", "Unverified carriers"],
] as const;

function displayDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function dateSort(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function SectionHeading({ number, title, count, id }: { number: string; title: string; count?: number; id: string }) {
  return (
    <div className="flex items-center gap-2 border-b-2 border-[#808080] bg-[#d4d0c8] px-3 py-2">
      <span aria-hidden="true" className="font-mono text-xs font-bold text-[#087c8d]">{number}</span>
      <h2 id={id} className="text-sm font-bold text-[#202020]">{title}</h2>
      {count !== undefined && <span className="ml-auto min-w-6 border border-[#808080] bg-white px-1.5 text-center font-mono text-xs">{count}</span>}
    </div>
  );
}

function EmptyRow({ children, columns }: { children: string; columns: number }) {
  return <tr><td colSpan={columns} className="!py-8 text-center text-sm text-[#555]">{children}</td></tr>;
}

function QueueTable({ group, go }: { group: QueueGroup; go: (href: string) => void }) {
  return (
    <div className="min-w-[610px] border-2 border-[#808080] border-b-white border-r-white bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)]">
      <div className="flex items-center justify-between border-b border-[#a0a0a0] bg-[#ece9e2] px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <BriefcaseBusiness className="h-4 w-4 shrink-0 text-[#087c8d]" />
          <h3 className="truncate text-xs font-bold text-[#222]">{group.agentName}</h3>
        </div>
        <span className="font-mono text-[11px] text-[#555]">{group.items.length} open</span>
      </div>
      <div className="overflow-x-auto">
        <table className="ff-data-table w-full min-w-[600px]" aria-label={`${group.agentName} invoice queue`} data-testid="queue-table">
          <thead><tr><th>Invoice #</th><th>Carrier</th><th>Broker</th><th>Status</th><th>Age</th><th>Action needed</th></tr></thead>
          <tbody>
            {group.items.length === 0 ? <EmptyRow columns={6}>No invoices in this queue.</EmptyRow> : group.items.map(item => (
              <tr
                key={item.id}
                role="link"
                tabIndex={0}
                aria-label={`Open invoice ${item.invoiceNumber}`}
                data-testid="queue-row"
                className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#087c8d]"
                onClick={() => go(item.href)}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    go(item.href);
                  }
                }}
              >
                <td className="font-mono font-semibold">
                  <a href={item.href} className="text-[#087c8d] underline-offset-2 hover:underline" onClick={event => { event.preventDefault(); event.stopPropagation(); go(item.href); }}>
                    {item.invoiceNumber}
                  </a>
                </td>
                <td>{item.carrierName}</td>
                <td>{item.brokerName}</td>
                <td><span className="ff-badge ff-badge-pending">{item.status.replace(/_/g, " ")}</span></td>
                <td className="whitespace-nowrap font-mono text-xs">
                  <span>{item.ageDays === null ? "—" : `${item.ageDays}d`}</span>
                  <span className="ml-1 text-[10px] text-[#666]">({item.ageBasis || "basis unavailable"})</span>
                </td>
                <td className="max-w-[220px]">
                  {item.actions.length ? <span className="flex flex-wrap gap-1">{item.actions.map((action, index) => <span key={`${action}-${index}`} className="border border-[#a0a0a0] bg-[#ece9e2] px-1.5 py-0.5 text-[11px]">{action}</span>)}</span> : <span className="text-[#666]">No action listed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Skeleton() {
  return <div aria-label="Loading dashboard" className="space-y-4" data-testid="dashboard-loading">
    {[1, 2, 3].map(row => <div key={row} className="h-24 animate-pulse border-2 border-[#a0a0a0] bg-[#dedbd3]" />)}
  </div>;
}

export default function Dashboard() {
  const [, go] = useLocation();
  const { user } = useAuth();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<DashboardData>({
    queryKey: ["/api/agent-dashboard", user?.id ?? "unauthenticated"],
    queryFn: async () => (await apiRequest("GET", "/api/agent-dashboard")).json(),
    retry: false,
    enabled: !!user?.id,
  });
  const responseMatchesUser = !!user?.id && data?.viewer.id === user.id;
  const dashboardData = responseMatchesUser ? data : undefined;
  const identityMismatch = Boolean(data && user?.id && !responseMatchesUser);
  const isManager = user?.role === "manager" || user?.role === "admin";
  const visibleGroups = useMemo(() => {
    if (!dashboardData || !user?.id) return [];
    if (isManager) return dashboardData.queueGroups;
    return dashboardData.queueGroups.filter(group => group.agentId === user.id);
  }, [dashboardData, isManager, user?.id]);
  const followUps = useMemo(() => [...(dashboardData?.followUps ?? [])].sort((a, b) => dateSort(a.dueDate) - dateSort(b.dueDate)), [dashboardData?.followUps]);
  const alerts = dashboardData?.alerts.filter(alert => alert.kind !== "fmcsa_run") ?? [];

  return (
    <AppShell title="Agent Dashboard" subtitle="Your work, follow-ups and operational alerts" group="Workspace">
      <div className="mx-auto max-w-[1680px] space-y-4 pb-8" data-testid="agent-dashboard">
        <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-[#808080] border-b-white border-r-white bg-[#d4d0c8] px-3 py-2 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]">
          <p className="text-xs text-[#444]">{dashboardData?.generatedAt ? `Updated ${displayDate(dashboardData.generatedAt)}` : "Live work queue"}</p>
          <Win95Button type="button" size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="dashboard-refresh" className="h-8 gap-1.5 px-2 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Win95Button>
        </div>

        {isLoading ? <Skeleton /> : isError ? (
          <div className="border-2 border-[#808080] bg-[#ece9e2] p-5 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]" data-testid="dashboard-error">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-[#a12b20]" />
              <div className="flex-1">
                <h2 className="font-bold text-[#222]">Dashboard could not be loaded</h2>
                <p className="mt-1 text-sm text-[#555]">{error instanceof Error ? error.message : "The work queue is temporarily unavailable."}</p>
                <Win95Button type="button" primary onClick={() => refetch()} className="mt-4">Retry</Win95Button>
              </div>
            </div>
          </div>
        ) : identityMismatch ? (
          <div className="border-2 border-[#808080] bg-[#ece9e2] p-5 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]" role="alert">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-[#a12b20]" />
              <div className="flex-1">
                <h2 className="font-bold text-[#222]">Dashboard session changed</h2>
                <p className="mt-1 text-sm text-[#555]">This response does not match the signed-in staff account. No previous account data is shown.</p>
                <Win95Button type="button" primary onClick={() => refetch()} className="mt-4">Refresh dashboard</Win95Button>
              </div>
            </div>
          </div>
        ) : dashboardData ? <>
          <section aria-labelledby="my-queue-heading" data-testid="section-queue">
            <div className="overflow-hidden border-2 border-[#808080] bg-[#ece9e2] shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]">
              <SectionHeading id="my-queue-heading" number="01" title="My Queue" count={visibleGroups.reduce((sum, group) => sum + group.items.length, 0)} />
              {visibleGroups.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[#555]">No queue items assigned to you.</p>
              ) : (
                <div className={`overflow-x-auto p-3 ${isManager ? "queue-groups-scroll" : ""}`} data-testid="queue-groups">
                  <div className={isManager ? "flex min-w-max items-start gap-3" : "min-w-0"}>
                    {visibleGroups.map(group => <QueueTable key={group.agentId ?? "unassigned"} group={group} go={go} />)}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="followups-heading" data-testid="section-followups">
            <div className="overflow-hidden border-2 border-[#808080] bg-[#ece9e2] shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]">
              <SectionHeading id="followups-heading" number="02" title="My Follow-ups" count={followUps.length} />
              <div className="overflow-x-auto">
                <table className="ff-data-table w-full min-w-[680px]" data-testid="followups-table">
                  <thead><tr><th>Follow-up</th><th>Carrier</th><th>Status</th><th>Priority</th><th>Due date</th><th>Source</th></tr></thead>
                  <tbody>{followUps.length ? followUps.map(task => (
                    <tr key={`${task.source}-${task.id}`} data-testid="followup-row">
                      <td className="font-semibold"><a href={task.href} onClick={event => { event.preventDefault(); go(task.href); }} className="text-[#087c8d] underline-offset-2 hover:underline">{task.title}</a></td>
                      <td>{task.carrierName ?? "—"}</td><td><span className="ff-badge ff-badge-pending">{task.status.replace(/_/g, " ")}</span></td>
                      <td>{task.priority}</td>
                      <td className="whitespace-nowrap font-mono text-xs">{task.dueDate ? displayDate(task.dueDate) : "No due date"}</td>
                      <td>{task.source}</td>
                    </tr>
                  )) : <EmptyRow columns={6}>No follow-ups assigned to you.</EmptyRow>}</tbody>
                </table>
              </div>
            </div>
          </section>

          <section aria-labelledby="activity-heading" data-testid="section-activity">
            <div className="overflow-hidden border-2 border-[#808080] bg-[#ece9e2] shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]">
              <SectionHeading id="activity-heading" number="03" title="Team Activity" count={dashboardData.activity.length} />
              <div className="overflow-x-auto">
                <table className="ff-data-table w-full min-w-[560px]" data-testid="activity-table">
                  <thead><tr><th>Who</th><th>Action</th><th>When</th><th>Record</th></tr></thead>
                  <tbody>{dashboardData.activity.length ? dashboardData.activity.slice(0, 20).map(event => (
                    <tr key={event.id} data-testid="activity-row">
                      <td className="font-semibold">{event.who}</td><td>{event.action}</td><td className="whitespace-nowrap font-mono text-xs">{displayDate(event.when)}</td>
                      <td>{event.href ? <a href={event.href} onClick={e => { e.preventDefault(); go(event.href!); }} className="inline-flex items-center gap-1 text-[#087c8d] underline-offset-2 hover:underline">Open <ArrowUpRight className="h-3 w-3" /></a> : "—"}</td>
                    </tr>
                  )) : <EmptyRow columns={4}>No recent team activity.</EmptyRow>}</tbody>
                </table>
              </div>
            </div>
          </section>

          <section aria-labelledby="alerts-heading" data-testid="section-alerts">
            <div className="overflow-hidden border-2 border-[#808080] bg-[#ece9e2] shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]">
              <SectionHeading id="alerts-heading" number="04" title="Alerts" count={alerts.length + 1} />
              <div className="border-b border-[#a0a0a0] p-3">
                <SystemHealthCard health={dashboardData.systemHealth.fmcsaAuthority} />
              </div>
              <div className="grid grid-cols-2 gap-px border-b border-[#a0a0a0] bg-[#a0a0a0] sm:grid-cols-4">
                {countKinds.map(([kind, label]) => <div key={kind} className="bg-[#f4f2ed] px-3 py-2">
                  <p className="font-mono text-lg font-bold text-[#087c8d]">{dashboardData.alertCounts[kind]}</p><p className="text-[11px] text-[#555]">{label}</p>
                </div>)}
              </div>
              <div className="overflow-x-auto">
                <table className="ff-data-table w-full min-w-[650px]" data-testid="alerts-table">
                  <thead><tr><th>Kind</th><th>Alert</th><th>Detail</th><th>Time</th><th>Link</th></tr></thead>
                  <tbody>{alerts.length ? alerts.map(alert => (
                    <tr key={alert.id} data-testid="alert-row">
                      <td><span className="ff-badge ff-badge-overdue">{alert.kind.replace(/_/g, " ")}</span></td>
                      <td className="font-semibold">{alert.title}</td>
                      <td>{alert.detail}</td>
                      <td className="whitespace-nowrap font-mono text-xs">{displayDate(alert.when)}</td>
                      <td><a href={alert.href} onClick={event => { event.preventDefault(); go(alert.href); }} className="inline-flex items-center gap-1 text-[#087c8d] underline-offset-2 hover:underline">Open <ArrowUpRight className="h-3 w-3" /></a></td>
                    </tr>
                  )) : <EmptyRow columns={5}>No other active alerts. All clear.</EmptyRow>}</tbody>
                </table>
              </div>
            </div>
          </section>
          <p className="flex items-center gap-1.5 text-[11px] text-[#555]"><Clock3 className="h-3.5 w-3.5" /> Queue ages include their basis; follow-ups are ordered by due date.</p>
        </> : null}
      </div>
      <style>{`.queue-groups-scroll{overscroll-behavior-x:contain;scrollbar-width:thin}.queue-groups-scroll>div>div{width:min(720px,82vw);flex:0 0 min(720px,82vw)}@media(max-width:767px){.queue-groups-scroll>div>div{width:calc(100vw - 78px);flex-basis:calc(100vw - 78px)}}`}</style>
    </AppShell>
  );
}
