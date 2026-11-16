import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/layout/AppShell";
import { FinancialSummary, WorkShortcuts, type FinancialDashboardData } from "@/components/dashboard/FinancialOverview";
import { FloatingActionGrid } from "@/components/dashboard/FloatingActionGrid";
import { NeuBadge, NeuButton, NeuCard, NeuTable } from "@/styles/neu";
import { AlertTriangle, ArrowUpRight, Clock3, RefreshCw } from "lucide-react";
import type {
  DashboardActivityPage,
  DashboardAlerts,
  DashboardFollowUps,
  DashboardSection,
} from "@shared/agent-dashboard";
import { pathToPermission } from "@/lib/routePermissions";
import { DASHBOARD_STALE_TIME } from "@/lib/dashboard-freshness";
import { TeamActivityFeed } from "@/components/dashboard/TeamActivityFeed";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { TeamAnnouncementBanner } from "@/components/team-announcements";
import "@/styles/ff-financial-dashboard.css";

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
    <NeuNotice severity="block" role="alert" className="flex items-start gap-3" data-testid={`dashboard-error-${section}`}>
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#a45e45]" />
      <div className="flex-1">
        <h3 className="font-semibold text-[#3e4946]">{section[0].toUpperCase() + section.slice(1)} could not be loaded</h3>
        <p className="mt-1 text-sm text-[#77817e]">{message}</p>
        <NeuButton variant="accent" onClick={retry} className="mt-3 !min-h-9 !px-4" data-testid={`dashboard-retry-${section}`}>Retry</NeuButton>
      </div>
    </NeuNotice>
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
  const { user, permissions } = useAuth();
  const userId = user?.id ?? "unauthenticated";
  const userRole = user?.role ?? "unknown";
  const queryOptions = { staleTime: DASHBOARD_STALE_TIME, refetchOnMount: true, refetchOnWindowFocus: true, retry: false, enabled: Boolean(user?.id && user?.role) };
  const followupsQuery = useQuery<DashboardFollowUps>({
    queryKey: ["/api/agent-dashboard/followups", userId, userRole],
    queryFn: ({ signal }) => fetchSection<DashboardFollowUps>("followups", signal),
    ...queryOptions,
  });
  const activityQuery = useInfiniteQuery<DashboardActivityPage, Error, InfiniteData<DashboardActivityPage, string | null>, [string, string, string, string], string | null>({
    queryKey: ["/api/agent-dashboard/activity", userId, userRole, "timeline"],
    queryFn: async ({ signal, pageParam }) => {
      const search = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : "";
      const response = await fetch(`/api/agent-dashboard/activity${search}`, { credentials: "include", signal });
      if (!response.ok) throw await responseError(response);
      return response.json() as Promise<DashboardActivityPage>;
    },
    initialPageParam: null,
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    ...queryOptions,
    refetchInterval: 30_000,
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
  const isFetching = followupsQuery.isFetching || activityQuery.isFetching || alertsQuery.isFetching || financialQuery.isFetching;

  const followupsMatches = matchesViewer(followupsQuery.data, user);
  const alertsMatches = matchesViewer(alertsQuery.data, user);
  const financialMatches = matchesViewer(financialQuery.data, user);

  const followupsData = followupsMatches ? followupsQuery.data : undefined;
  const alertsData = alertsMatches ? alertsQuery.data : undefined;
  const financialData = financialMatches ? financialQuery.data : undefined;
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
      followupsQuery.refetch(),
      activityQuery.refetch(),
      alertsQuery.refetch(),
      financialQuery.refetch(),
    ]);
    const failed = results.filter(result => result.status === "rejected" || result.value.isError).length;
    setRefreshStatus(failed ? `${failed} section${failed === 1 ? "" : "s"} could not refresh.` : "Refresh complete.");
  };

  const followupsLoading = !user?.id || !user.role || followupsQuery.isLoading;
  const activityLoading = !user?.id || !user.role || activityQuery.isLoading;
  const alertsLoading = !user?.id || !user.role || alertsQuery.isLoading;
  const financialLoading = !user?.id || !user.role || financialQuery.isLoading;
  const financialError = identityMismatch(financialQuery.data, user)
    ? new Error("This response does not match the signed-in account.")
    : financialQuery.error;
  const canVisit = (path: string) => {
    const permission = pathToPermission(path);
    return user?.role === "admin" || !permission || permissions.includes(permission);
  };
  const agentName = `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || user?.name || "Agent";

  return (
    <AppShell
      title="Agent Dashboard"
      subtitle="Your work, follow-ups and operational alerts"
      group="Workspace"
      neu
      className="ff-financial-dashboard-shell"
      actions={<NeuButton
        type="button"
        aria-label="Refresh dashboard"
        title="Refresh dashboard"
        onClick={refreshAll}
        disabled={isFetching || !user?.id || !user.role}
        data-testid="dashboard-refresh"
        className="ff-neu-dashboard-refresh h-9 w-9 shrink-0 rounded-full p-0"
      >
        <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
      </NeuButton>}
    >
      <div className="ff-neu-dashboard" data-testid="agent-dashboard" data-dashboard-loading={financialLoading ? "" : undefined}>
        <p role="status" className="sr-only" aria-live="polite">{refreshStatus}</p>

        <TeamAnnouncementBanner compact />

        <FinancialSummary
          data={financialData}
          isLoading={financialLoading}
          error={financialError}
          agentName={agentName}
          onRetry={() => financialQuery.refetch()}
          children={<FloatingActionGrid
            data={financialData?.actionGrid}
            isLoading={financialLoading}
            error={financialError ?? (financialData && !financialData.actionGrid ? new Error("Action grid data is missing from the financial summary.") : undefined)}
            onRetry={() => financialQuery.refetch()}
            canVisit={canVisit}
            onNavigate={go}
          />}
        />

        <section aria-labelledby="followups-heading" data-testid="section-followups" className="mb-5">
          <NeuCard className="ff-neu-work-section">
            <SectionHeading id="followups-heading" number="01" title="My Follow-ups" count={followupsData?.totalCount} />
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
            <SectionHeading id="activity-heading" number="02" title="Team Activity" />
            <TeamActivityFeed
              query={activityQuery}
              isLoading={activityLoading}
              identityError={identityMismatch(activityQuery.data?.pages[0], user) ? new Error("This response does not match the signed-in account.") : undefined}
              onRetry={() => activityQuery.refetch()}
              onNavigate={go}
            />
          </NeuCard>
        </section>

        <section aria-labelledby="alerts-heading" data-testid="section-alerts">
          <NeuCard className="ff-neu-work-section">
            <SectionHeading id="alerts-heading" number="03" title="Alerts" count={alertTotal} />
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
