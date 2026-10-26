import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/layout/AppShell";
import { SystemHealthCard } from "@/components/dashboard/SystemHealthCard";
import { Win95Button } from "@/components/win95";
import { AlertTriangle, ArrowUpRight, BriefcaseBusiness, Clock3, RefreshCw } from "lucide-react";
import type {
  DashboardActivityFeed,
  DashboardAlerts,
  DashboardFollowUps,
  DashboardQueue,
  DashboardSection,
} from "@shared/agent-dashboard";

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

function QueueTable({ group, go }: { group: DashboardQueue["queueGroups"][number]; go: (href: string) => void }) {
  const truncated = group.items.length < group.totalCount;
  return (
    <div className="min-w-[610px] border-2 border-[#808080] border-b-white border-r-white bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)]">
      <div className="flex items-center justify-between border-b border-[#a0a0a0] bg-[#ece9e2] px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <BriefcaseBusiness className="h-4 w-4 shrink-0 text-[#087c8d]" />
          <h3 className="truncate text-xs font-bold text-[#222]">{group.agentName}</h3>
        </div>
        <span className="font-mono text-[11px] text-[#555]">{group.totalCount} open</span>
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
      {truncated && (
        <div className="flex items-center justify-between gap-3 border-t border-[#a0a0a0] bg-[#f4f2ed] px-2.5 py-2 text-[11px]">
          <span className="font-mono text-[#555]">Showing {group.items.length} of {group.totalCount}</span>
          <a href="/invoices" onClick={event => { event.preventDefault(); go("/invoices"); }} className="font-bold text-[#087c8d] underline underline-offset-2">View invoices</a>
        </div>
      )}
    </div>
  );
}

function QueueSkeleton() {
  return <div className="space-y-3 p-3" data-testid="queue-loading" aria-label="Loading queue">
    {[0, 1].map(card => <div key={card} className="overflow-hidden border-2 border-[#a0a0a0] bg-white">
      <div className="h-9 animate-pulse bg-[#dedbd3]" />
      <div className="space-y-2 p-3">{[0, 1, 2].map(row => <div key={row} className="h-8 animate-pulse bg-[#ece9e2]" />)}</div>
    </div>)}
  </div>;
}

function TableSkeleton({ testId, rows, columns }: { testId: string; rows: number; columns: number }) {
  return <div className="overflow-x-auto p-3" data-testid={testId} aria-label="Loading section">
    <div className="min-w-[600px] border border-[#a0a0a0]">
      <div className="flex gap-2 border-b border-[#a0a0a0] bg-[#dedbd3] p-2">{Array.from({ length: columns }, (_, index) => <div key={index} className="h-4 flex-1 animate-pulse bg-[#c7c4bc]" />)}</div>
      {Array.from({ length: rows }, (_, row) => <div key={row} className="flex gap-2 border-b border-[#d0cdc5] p-2">{Array.from({ length: columns }, (_, col) => <div key={col} className="h-5 flex-1 animate-pulse bg-[#ece9e2]" />)}</div>)}
    </div>
  </div>;
}

function SectionError({ section, error, retry }: { section: DashboardSection; error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : "This dashboard section is temporarily unavailable.";
  return (
    <div className="m-3 border-2 border-[#808080] bg-[#ece9e2] p-4 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]" role="alert" data-testid={`dashboard-error-${section}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#a12b20]" />
        <div className="flex-1">
          <h3 className="font-bold text-[#222]">{section[0].toUpperCase() + section.slice(1)} could not be loaded</h3>
          <p className="mt-1 text-sm text-[#555]">{message}</p>
          <Win95Button type="button" primary onClick={retry} className="mt-3" data-testid={`dashboard-retry-${section}`}>Retry</Win95Button>
        </div>
      </div>
    </div>
  );
}

function responseError(response: Response) {
  return response.text().then(text => {
    let message = text || `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      // Keep the response text for plain-text and non-JSON errors.
    }
    return new Error(message);
  });
}

async function fetchSection<T>(endpoint: DashboardSection, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/agent-dashboard/${endpoint}`, { credentials: "include", signal });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<T>;
}

function matchesViewer(data: { viewer: { id: string; role: string } } | undefined, user: { id: string; role?: string } | null | undefined) {
  return Boolean(data && user?.id && user.role && data.viewer.id === user.id && data.viewer.role === user.role);
}

function identityMismatch(data: { viewer: { id: string; role: string } } | undefined, user: { id: string; role?: string } | null | undefined) {
  return Boolean(data && user?.id && !matchesViewer(data, user));
}

export default function Dashboard() {
  const [, go] = useLocation();
  const { user } = useAuth();
  const userId = user?.id ?? "unauthenticated";
  const userRole = user?.role ?? "unknown";
  const queryOptions = { staleTime: 15_000, refetchOnMount: "always" as const, refetchOnWindowFocus: true, retry: false, enabled: Boolean(user?.id && user?.role) };
  const queueQuery = useQuery<DashboardQueue>({
    queryKey: ["/api/agent-dashboard/queue", userId, userRole],
    queryFn: ({ signal }) => fetchSection<DashboardQueue>("queue", signal),
    ...queryOptions,
  });
  const followupsQuery = useQuery<DashboardFollowUps>({
    queryKey: ["/api/agent-dashboard/followups", userId, userRole],
    queryFn: ({ signal }) => fetchSection<DashboardFollowUps>("followups", signal),
    ...queryOptions,
  });
  const activityQuery = useQuery<DashboardActivityFeed>({
    queryKey: ["/api/agent-dashboard/activity", userId, userRole],
    queryFn: ({ signal }) => fetchSection<DashboardActivityFeed>("activity", signal),
    ...queryOptions,
  });
  const alertsQuery = useQuery<DashboardAlerts>({
    queryKey: ["/api/agent-dashboard/alerts", userId, userRole],
    queryFn: ({ signal }) => fetchSection<DashboardAlerts>("alerts", signal),
    ...queryOptions,
  });
  const [refreshStatus, setRefreshStatus] = useState("");
  const isFetching = queueQuery.isFetching || followupsQuery.isFetching || activityQuery.isFetching || alertsQuery.isFetching;

  const queueMatches = matchesViewer(queueQuery.data, user);
  const followupsMatches = matchesViewer(followupsQuery.data, user);
  const activityMatches = matchesViewer(activityQuery.data, user);
  const alertsMatches = matchesViewer(alertsQuery.data, user);

  const queue = queueMatches ? queueQuery.data : undefined;
  const followupsData = followupsMatches ? followupsQuery.data : undefined;
  const activityData = activityMatches ? activityQuery.data : undefined;
  const alertsData = alertsMatches ? alertsQuery.data : undefined;
  const isManager = user?.role === "manager" || user?.role === "admin";
  const visibleGroups = useMemo(() => {
    if (!queue || !user?.id) return [];
    if (isManager) return queue.queueGroups;
    return queue.queueGroups.filter(group => group.agentId === user.id);
  }, [queue, isManager, user?.id]);
  const orderedFollowups = useMemo(
    () => [...(followupsData?.followUps ?? [])].sort((a, b) => dateSort(a.dueDate) - dateSort(b.dueDate)),
    [followupsData?.followUps],
  );
  const alertTotal = alertsData
    ? alertsData.alertCounts.email_bounced + alertsData.alertCounts.ocr_failed + alertsData.alertCounts.unverified_carrier
    : undefined;

  const refreshAll = async () => {
    setRefreshStatus("Refreshing all sections…");
    const results = await Promise.allSettled([
      queueQuery.refetch(),
      followupsQuery.refetch(),
      activityQuery.refetch(),
      alertsQuery.refetch(),
    ]);
    const failed = results.filter(result => result.status === "rejected" || result.value.isError).length;
    setRefreshStatus(failed ? `${failed} section${failed === 1 ? "" : "s"} could not refresh.` : "Refresh complete.");
  };

  const updatedAt = [queue, followupsData, activityData, alertsData]
    .map(data => data?.generatedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  const queueLoading = !user?.id || !user.role || queueQuery.isLoading;
  const followupsLoading = !user?.id || !user.role || followupsQuery.isLoading;
  const activityLoading = !user?.id || !user.role || activityQuery.isLoading;
  const alertsLoading = !user?.id || !user.role || alertsQuery.isLoading;

  return (
    <AppShell title="Agent Dashboard" subtitle="Your work, follow-ups and operational alerts" group="Workspace">
      <div className="mx-auto max-w-[1680px] space-y-4 pb-8" data-testid="agent-dashboard">
        <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-[#808080] border-b-white border-r-white bg-[#d4d0c8] px-3 py-2 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]">
          <div>
            <p className="text-xs text-[#444]">{updatedAt ? `Updated ${displayDate(updatedAt)}` : "Live work queue"}</p>
            {refreshStatus && <p role="status" className="mt-0.5 text-[11px] text-[#555]">{refreshStatus}</p>}
          </div>
          <Win95Button type="button" size="sm" variant="outline" onClick={refreshAll} disabled={isFetching || !user?.id || !user.role} data-testid="dashboard-refresh" className="h-8 gap-1.5 px-2 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Win95Button>
        </div>

        <section aria-labelledby="my-queue-heading" data-testid="section-queue">
          <div className="overflow-hidden border-2 border-[#808080] bg-[#ece9e2] shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]">
            <SectionHeading id="my-queue-heading" number="01" title="My Queue" count={queue ? queue.queueCount : undefined} />
            {queueLoading ? <QueueSkeleton /> : queueQuery.isError || identityMismatch(queueQuery.data, user) ? (
              <SectionError section="queue" error={queueQuery.error ?? new Error("This response does not match the signed-in account.")} retry={() => queueQuery.refetch()} />
            ) : queue ? visibleGroups.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[#555]">No queue items assigned to you.</p>
            ) : (
              <div className={`overflow-x-auto p-3 ${isManager ? "queue-groups-scroll" : ""}`} data-testid="queue-groups">
                <div className={isManager ? "flex min-w-max items-start gap-3" : "min-w-0"}>
                  {visibleGroups.map(group => <QueueTable key={group.agentId ?? "unassigned"} group={group} go={go} />)}
                </div>
              </div>
            ) : <QueueSkeleton />}
          </div>
        </section>

        <section aria-labelledby="followups-heading" data-testid="section-followups">
          <div className="overflow-hidden border-2 border-[#808080] bg-[#ece9e2] shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]">
            <SectionHeading id="followups-heading" number="02" title="My Follow-ups" count={followupsData?.totalCount} />
            {followupsLoading ? <TableSkeleton testId="followups-loading" rows={4} columns={6} /> : followupsQuery.isError || identityMismatch(followupsQuery.data, user) ? (
              <SectionError section="followups" error={followupsQuery.error ?? new Error("This response does not match the signed-in account.")} retry={() => followupsQuery.refetch()} />
            ) : followupsData ? <>
              <div className="overflow-x-auto">
                <table className="ff-data-table w-full min-w-[680px]" data-testid="followups-table">
                  <thead><tr><th>Follow-up</th><th>Carrier</th><th>Status</th><th>Priority</th><th>Due date</th><th>Source</th></tr></thead>
                  <tbody>{orderedFollowups.length ? orderedFollowups.map(task => (
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
              {followupsData.totalCount > orderedFollowups.length && (
                <div className="flex items-center justify-between gap-3 border-t border-[#a0a0a0] bg-[#f4f2ed] px-3 py-2 text-[11px]">
                  <span className="font-mono text-[#555]">Showing {orderedFollowups.length} of {followupsData.totalCount}</span>
                  <a href="/follow-up" onClick={event => { event.preventDefault(); go("/follow-up"); }} className="font-bold text-[#087c8d] underline underline-offset-2">View more</a>
                </div>
              )}
            </> : <TableSkeleton testId="followups-loading" rows={4} columns={6} />}
          </div>
        </section>

        <section aria-labelledby="activity-heading" data-testid="section-activity">
          <div className="overflow-hidden border-2 border-[#808080] bg-[#ece9e2] shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]">
            <SectionHeading id="activity-heading" number="03" title="Team Activity" count={activityData?.activity.length} />
            {activityLoading ? <TableSkeleton testId="activity-loading" rows={4} columns={4} /> : activityQuery.isError || identityMismatch(activityQuery.data, user) ? (
              <SectionError section="activity" error={activityQuery.error ?? new Error("This response does not match the signed-in account.")} retry={() => activityQuery.refetch()} />
            ) : activityData ? (
              <div className="overflow-x-auto">
                <table className="ff-data-table w-full min-w-[560px]" data-testid="activity-table">
                  <thead><tr><th>Who</th><th>Action</th><th>When</th><th>Record</th></tr></thead>
                  <tbody>{activityData.activity.length ? activityData.activity.map(event => (
                    <tr key={event.id} data-testid="activity-row">
                      <td className="font-semibold">{event.who}</td><td>{event.action}</td><td className="whitespace-nowrap font-mono text-xs">{displayDate(event.when)}</td>
                      <td>{event.href ? <a href={event.href} onClick={e => { e.preventDefault(); go(event.href!); }} className="inline-flex items-center gap-1 text-[#087c8d] underline-offset-2 hover:underline">Open <ArrowUpRight className="h-3 w-3" /></a> : "—"}</td>
                    </tr>
                  )) : <EmptyRow columns={4}>No recent team activity.</EmptyRow>}</tbody>
                </table>
              </div>
            ) : <TableSkeleton testId="activity-loading" rows={4} columns={4} />}
          </div>
        </section>

        <section aria-labelledby="alerts-heading" data-testid="section-alerts">
          <div className="overflow-hidden border-2 border-[#808080] bg-[#ece9e2] shadow-[inset_1px_1px_2px_rgba(255,255,255,0.8)]">
            <SectionHeading id="alerts-heading" number="04" title="Alerts" count={alertTotal} />
            {alertsLoading ? <div className="space-y-3 p-3" data-testid="alerts-loading" aria-label="Loading alerts">
              <div className="h-20 animate-pulse border-2 border-[#a0a0a0] bg-[#dedbd3]" />
              <div className="h-12 animate-pulse border border-[#a0a0a0] bg-[#dedbd3]" />
              <TableSkeleton testId="alerts-loading-table" rows={3} columns={5} />
            </div> : alertsQuery.isError || identityMismatch(alertsQuery.data, user) ? (
              <SectionError section="alerts" error={alertsQuery.error ?? new Error("This response does not match the signed-in account.")} retry={() => alertsQuery.refetch()} />
            ) : alertsData ? <>
              <div className="border-b border-[#a0a0a0] p-3">
                <SystemHealthCard health={alertsData.systemHealth.fmcsaAuthority} />
              </div>
              <div className="grid grid-cols-2 gap-px border-b border-[#a0a0a0] bg-[#a0a0a0] sm:grid-cols-4">
                {countKinds.map(([kind, label]) => <div key={kind} className="bg-[#f4f2ed] px-3 py-2">
                  <p className="font-mono text-lg font-bold text-[#087c8d]">{alertsData.alertCounts[kind]}</p><p className="text-[11px] text-[#555]">{label}</p>
                </div>)}
              </div>
              <div className="overflow-x-auto">
                <table className="ff-data-table w-full min-w-[650px]" data-testid="alerts-table">
                  <thead><tr><th>Kind</th><th>Alert</th><th>Detail</th><th>Time</th><th>Link</th></tr></thead>
                  <tbody>{alertsData.alerts.length ? alertsData.alerts.map(alert => (
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
            </> : <div data-testid="alerts-loading"><TableSkeleton testId="alerts-loading-table" rows={3} columns={5} /></div>}
          </div>
        </section>

        <p className="flex items-center gap-1.5 text-[11px] text-[#555]"><Clock3 className="h-3.5 w-3.5" /> Queue ages include their basis; follow-ups are ordered by due date.</p>
      </div>
      <style>{`.queue-groups-scroll{overscroll-behavior-x:contain;scrollbar-width:thin}.queue-groups-scroll>div>div{width:min(720px,82vw);flex:0 0 min(720px,82vw)}@media(max-width:767px){.queue-groups-scroll>div>div{width:calc(100vw - 78px);flex-basis:calc(100vw - 78px)}}`}</style>
    </AppShell>
  );
}
