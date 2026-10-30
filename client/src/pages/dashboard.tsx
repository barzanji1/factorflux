import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/layout/AppShell";
import { FinancialSummary, WorkShortcuts, type FinancialDashboardData } from "@/components/dashboard/FinancialOverview";
import { NeuBadge, NeuButton, NeuCard, NeuTable } from "@/styles/neu";
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
    <div className="ff-neu-section-heading">
      <span aria-hidden="true" className="ff-neu-section-number">{number}</span>
      <h2 id={id} className="ff-neu-section-title">{title}</h2>
      {count !== undefined && <NeuBadge className="ml-auto">{count.toLocaleString()}</NeuBadge>}
    </div>
  );
}

function EmptyRow({ children, columns }: { children: string; columns: number }) {
  return <tr><td colSpan={columns} className="!py-8 text-center text-sm text-[#77817e]">{children}</td></tr>;
}

function QueueTable({ group, go }: { group: DashboardQueue["queueGroups"][number]; go: (href: string) => void }) {
  const truncated = group.items.length < group.totalCount;
  return (
    <NeuCard pressed className="ff-neu-queue-card">
      <div className="ff-neu-queue-heading">
        <div className="flex min-w-0 items-center gap-2">
          <BriefcaseBusiness className="h-4 w-4 shrink-0 text-[#168f99]" />
          <h3 className="truncate text-sm font-semibold text-[#3e4946]">{group.agentName}</h3>
        </div>
        <span className="ff-neu-small-count">{group.totalCount} open</span>
      </div>
      <NeuTable className="ff-neu-table w-full min-w-[700px]" aria-label={`${group.agentName} invoice queue`} data-testid="queue-table">
        <thead><tr><th>Invoice #</th><th>Carrier</th><th>Broker</th><th>Status</th><th>Age</th><th>Action needed</th></tr></thead>
        <tbody>
          {group.items.length === 0 ? <EmptyRow columns={6}>No invoices in this queue.</EmptyRow> : group.items.map(item => (
            <tr
              key={item.id}
              role="link"
              tabIndex={0}
              aria-label={`Open invoice ${item.invoiceNumber}`}
              data-testid="queue-row"
              className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#168f99]"
              onClick={() => go(item.href)}
              onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  go(item.href);
                }
              }}
            >
              <td className="font-mono font-semibold">
                <a href={item.href} className="text-[#168f99] underline-offset-2 hover:underline" onClick={event => { event.preventDefault(); event.stopPropagation(); go(item.href); }}>
                  {item.invoiceNumber}
                </a>
              </td>
              <td>{item.carrierName}</td>
              <td>{item.brokerName}</td>
              <td><NeuBadge tone="warning">{item.status.replace(/_/g, " ")}</NeuBadge></td>
              <td className="whitespace-nowrap font-mono text-xs">
                <span>{item.ageDays === null ? "—" : `${item.ageDays}d`}</span>
                <span className="ml-1 text-[10px] text-[#818a87]">({item.ageBasis || "basis unavailable"})</span>
              </td>
              <td className="max-w-[220px]">
                {item.actions.length ? <span className="flex flex-wrap gap-1">{item.actions.map((action, index) => <NeuBadge key={`${action}-${index}`} className="text-[10px]">{action}</NeuBadge>)}</span> : <span className="text-[#818a87]">No action listed</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </NeuTable>
      {truncated && (
        <div className="ff-neu-table-footer">
          <span>Showing {group.items.length} of {group.totalCount}</span>
          <button type="button" onClick={() => go("/invoices")} className="ff-neu-text-link">View invoices <ArrowUpRight className="h-3 w-3" /></button>
        </div>
      )}
    </NeuCard>
  );
}

function QueueSkeleton() {
  return <div className="space-y-3 p-4" data-testid="queue-loading" aria-label="Loading queue">
    {[0, 1].map(card => <div key={card} className="ff-neu-skeleton-card">
      <div className="h-8 w-40 animate-pulse rounded-xl bg-[#e0e0e0] shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]" />
      <div className="mt-4 space-y-2">{[0, 1, 2].map(row => <div key={row} className="h-7 animate-pulse rounded-lg bg-[#e0e0e0] shadow-[inset_3px_3px_6px_#c1c1c1,inset_-3px_-3px_6px_#fff]" />)}</div>
    </div>)}
  </div>;
}

function TableSkeleton({ testId, rows, columns }: { testId: string; rows: number; columns: number }) {
  return <div className="space-y-3 p-4" data-testid={testId} aria-label="Loading section">
    <div className="ff-neu-skeleton-card">
      <div className="flex gap-3 pb-3">{Array.from({ length: columns }, (_, index) => <div key={index} className="h-3 flex-1 animate-pulse rounded-full bg-[#d3d6d3]" />)}</div>
      {Array.from({ length: rows }, (_, row) => <div key={row} className="flex gap-3 border-t border-[#d0d3d0] py-3">{Array.from({ length: columns }, (_, col) => <div key={col} className="h-4 flex-1 animate-pulse rounded-full bg-[#d5d8d5]" />)}</div>)}
    </div>
  </div>;
}

function SectionError({ section, error, retry }: { section: DashboardSection; error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : "This dashboard section is temporarily unavailable.";
  return (
    <div className="ff-neu-section-error" role="alert" data-testid={`dashboard-error-${section}`}>
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#a45e45]" />
      <div className="flex-1">
        <h3 className="font-semibold text-[#3e4946]">{section[0].toUpperCase() + section.slice(1)} could not be loaded</h3>
        <p className="mt-1 text-sm text-[#77817e]">{message}</p>
        <NeuButton variant="accent" onClick={retry} className="mt-3 !min-h-9 !px-4" data-testid={`dashboard-retry-${section}`}>Retry</NeuButton>
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

async function fetchFinancial(signal: AbortSignal): Promise<FinancialDashboardData> {
  const response = await fetch("/api/agent-dashboard/financial", { credentials: "include", signal });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<FinancialDashboardData>;
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
  const financialQuery = useQuery<FinancialDashboardData>({
    queryKey: ["/api/agent-dashboard/financial", userId, userRole],
    queryFn: ({ signal }) => fetchFinancial(signal),
    ...queryOptions,
  });
  const [refreshStatus, setRefreshStatus] = useState("");
  const isFetching = queueQuery.isFetching || followupsQuery.isFetching || activityQuery.isFetching || alertsQuery.isFetching || financialQuery.isFetching;

  const queueMatches = matchesViewer(queueQuery.data, user);
  const followupsMatches = matchesViewer(followupsQuery.data, user);
  const activityMatches = matchesViewer(activityQuery.data, user);
  const alertsMatches = matchesViewer(alertsQuery.data, user);
  const financialMatches = matchesViewer(financialQuery.data, user);

  const queue = queueMatches ? queueQuery.data : undefined;
  const followupsData = followupsMatches ? followupsQuery.data : undefined;
  const activityData = activityMatches ? activityQuery.data : undefined;
  const alertsData = alertsMatches ? alertsQuery.data : undefined;
  const financialData = financialMatches ? financialQuery.data : undefined;
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
    ? alertsData.alertCounts.email_bounced + alertsData.alertCounts.ocr_failed
    : undefined;

  const refreshAll = async () => {
    setRefreshStatus("Refreshing dashboard data…");
    const results = await Promise.allSettled([
      queueQuery.refetch(),
      followupsQuery.refetch(),
      activityQuery.refetch(),
      alertsQuery.refetch(),
      financialQuery.refetch(),
    ]);
    const failed = results.filter(result => result.status === "rejected" || result.value.isError).length;
    setRefreshStatus(failed ? `${failed} section${failed === 1 ? "" : "s"} could not refresh.` : "Refresh complete.");
  };

  const updatedAt = [queue, followupsData, activityData, alertsData, financialData]
    .map(data => data?.generatedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  const queueLoading = !user?.id || !user.role || queueQuery.isLoading;
  const followupsLoading = !user?.id || !user.role || followupsQuery.isLoading;
  const activityLoading = !user?.id || !user.role || activityQuery.isLoading;
  const alertsLoading = !user?.id || !user.role || alertsQuery.isLoading;
  const financialLoading = !user?.id || !user.role || financialQuery.isLoading;
  const financialError = identityMismatch(financialQuery.data, user)
    ? new Error("This response does not match the signed-in account.")
    : financialQuery.error;

  return (
    <AppShell title="Agent Dashboard" subtitle="Your work, follow-ups and operational alerts" group="Workspace" neu>
      <div className="ff-neu-dashboard" data-testid="agent-dashboard">
        <div className="ff-neu-dashboard-toolbar">
          <div>
            <p className="ff-neu-updated">{updatedAt ? `Updated ${displayDate(updatedAt)}` : "Live work queue"}</p>
            {refreshStatus && <p role="status" className="mt-1 text-xs text-[#77817e]">{refreshStatus}</p>}
          </div>
          <NeuButton type="button" onClick={refreshAll} disabled={isFetching || !user?.id || !user.role} data-testid="dashboard-refresh" className="ff-neu-refresh">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </NeuButton>
        </div>

        <FinancialSummary
          data={financialData}
          isLoading={financialLoading}
          error={financialError}
          onRetry={() => financialQuery.refetch()}
        />

        <div className="mt-8 mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="ff-neu-eyebrow">The work itself</p>
            <h2 className="ff-neu-section-title">Operational queue</h2>
          </div>
          <span className="hidden text-xs text-[#8b9591] sm:inline">Each workstream loads independently</span>
        </div>
        <section aria-labelledby="my-queue-heading" data-testid="section-queue" className="mb-5">
          <NeuCard className="ff-neu-work-section">
            <SectionHeading id="my-queue-heading" number="01" title="My Queue" count={queue?.queueCount} />
            {queueLoading ? <QueueSkeleton /> : queueQuery.isError || identityMismatch(queueQuery.data, user) ? (
              <SectionError section="queue" error={queueQuery.error ?? new Error("This response does not match the signed-in account.")} retry={() => queueQuery.refetch()} />
            ) : queue ? visibleGroups.length === 0 ? (
              <p className="ff-neu-empty-state">No queue items assigned to you.</p>
            ) : (
              <div className={`ff-neu-queue-scroll ${isManager ? "queue-groups-scroll" : ""}`} data-testid="queue-groups">
                <div className={isManager ? "flex min-w-max items-start gap-4" : "min-w-0"}>
                  {visibleGroups.map(group => <QueueTable key={group.agentId ?? "unassigned"} group={group} go={go} />)}
                </div>
              </div>
            ) : <QueueSkeleton />}
          </NeuCard>
        </section>

        <section aria-labelledby="followups-heading" data-testid="section-followups" className="mb-5">
          <NeuCard className="ff-neu-work-section">
            <SectionHeading id="followups-heading" number="02" title="My Follow-ups" count={followupsData?.totalCount} />
            {followupsLoading ? <TableSkeleton testId="followups-loading" rows={4} columns={6} /> : followupsQuery.isError || identityMismatch(followupsQuery.data, user) ? (
              <SectionError section="followups" error={followupsQuery.error ?? new Error("This response does not match the signed-in account.")} retry={() => followupsQuery.refetch()} />
            ) : followupsData ? <>
              <NeuTable className="ff-neu-table w-full min-w-[700px]" data-testid="followups-table">
                <thead><tr><th>Follow-up</th><th>Carrier</th><th>Status</th><th>Priority</th><th>Due date</th><th>Source</th></tr></thead>
                <tbody>{orderedFollowups.length ? orderedFollowups.map(task => (
                  <tr key={`${task.source}-${task.id}`} data-testid="followup-row">
                    <td className="font-semibold"><a href={task.href} onClick={event => { event.preventDefault(); go(task.href); }} className="text-[#168f99] underline-offset-2 hover:underline">{task.title}</a></td>
                    <td>{task.carrierName ?? "—"}</td><td><NeuBadge tone="warning">{task.status.replace(/_/g, " ")}</NeuBadge></td>
                    <td>{task.priority}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{task.dueDate ? displayDate(task.dueDate) : "No due date"}</td>
                    <td>{task.source}</td>
                  </tr>
                )) : <EmptyRow columns={6}>No follow-ups assigned to you.</EmptyRow>}</tbody>
              </NeuTable>
              {followupsData.totalCount > orderedFollowups.length && (
                <div className="ff-neu-table-footer">
                  <span>Showing {orderedFollowups.length} of {followupsData.totalCount}</span>
                  <button type="button" onClick={() => go("/follow-up")} className="ff-neu-text-link">View more <ArrowUpRight className="h-3 w-3" /></button>
                </div>
              )}
            </> : <TableSkeleton testId="followups-loading" rows={4} columns={6} />}
          </NeuCard>
        </section>

        <section aria-labelledby="activity-heading" data-testid="section-activity" className="mb-5">
          <NeuCard className="ff-neu-work-section">
            <SectionHeading id="activity-heading" number="03" title="Team Activity" count={activityData?.activity.length} />
            {activityLoading ? <TableSkeleton testId="activity-loading" rows={4} columns={4} /> : activityQuery.isError || identityMismatch(activityQuery.data, user) ? (
              <SectionError section="activity" error={activityQuery.error ?? new Error("This response does not match the signed-in account.")} retry={() => activityQuery.refetch()} />
            ) : activityData ? (
              <NeuTable className="ff-neu-table w-full min-w-[580px]" data-testid="activity-table">
                <thead><tr><th>Who</th><th>Action</th><th>When</th><th>Record</th></tr></thead>
                <tbody>{activityData.activity.length ? activityData.activity.map(event => (
                  <tr key={event.id} data-testid="activity-row">
                    <td className="font-semibold">{event.who}</td><td>{event.action}</td><td className="whitespace-nowrap font-mono text-xs">{displayDate(event.when)}</td>
                    <td>{event.href ? <button type="button" onClick={() => go(event.href!)} className="ff-neu-text-link">Open <ArrowUpRight className="h-3 w-3" /></button> : "—"}</td>
                  </tr>
                )) : <EmptyRow columns={4}>No recent team activity.</EmptyRow>}</tbody>
              </NeuTable>
            ) : <TableSkeleton testId="activity-loading" rows={4} columns={4} />}
          </NeuCard>
        </section>

        <section aria-labelledby="alerts-heading" data-testid="section-alerts">
          <NeuCard className="ff-neu-work-section">
            <SectionHeading id="alerts-heading" number="04" title="Alerts" count={alertTotal} />
            {alertsLoading ? <div data-testid="alerts-loading"><TableSkeleton testId="alerts-loading-table" rows={3} columns={5} /></div> : alertsQuery.isError || identityMismatch(alertsQuery.data, user) ? (
              <SectionError section="alerts" error={alertsQuery.error ?? new Error("This response does not match the signed-in account.")} retry={() => alertsQuery.refetch()} />
            ) : alertsData ? <>
              <div className="grid grid-cols-2 gap-px px-4 pt-3">
                {countKinds.map(([kind, label]) => <div key={kind} className="ff-neu-alert-count">
                  <p className="font-mono text-lg font-bold text-[#168f99]">{alertsData.alertCounts[kind]}</p><p className="text-[11px] text-[#77817e]">{label}</p>
                </div>)}
              </div>
              <NeuTable className="ff-neu-table w-full min-w-[680px]" data-testid="alerts-table">
                <thead><tr><th>Kind</th><th>Alert</th><th>Detail</th><th>Time</th><th>Link</th></tr></thead>
                <tbody>{alertsData.alerts.length ? alertsData.alerts.map(alert => (
                  <tr key={alert.id} data-testid="alert-row">
                    <td><NeuBadge tone="warning">{alert.kind.replace(/_/g, " ")}</NeuBadge></td>
                    <td className="font-semibold">{alert.title}</td>
                    <td>{alert.detail}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{displayDate(alert.when)}</td>
                    <td><button type="button" onClick={() => go(alert.href)} className="ff-neu-text-link">Open <ArrowUpRight className="h-3 w-3" /></button></td>
                  </tr>
                )) : <EmptyRow columns={5}>No alerts</EmptyRow>}</tbody>
              </NeuTable>
            </> : <div data-testid="alerts-loading"><TableSkeleton testId="alerts-loading-table" rows={3} columns={5} /></div>}
          </NeuCard>
        </section>

        <WorkShortcuts
          followupCount={followupsData?.totalCount}
          onViewFollowups={() => go("/follow-up")}
          pendingActions={financialData?.kpis.pendingActions}
          onViewActions={() => go("/invoices")}
        />

        <p className="ff-neu-dashboard-note"><Clock3 className="h-3.5 w-3.5" /> Queue ages include their basis; follow-ups are ordered by due date.</p>
      </div>
    </AppShell>
  );
}
