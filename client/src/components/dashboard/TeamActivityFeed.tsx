import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, ChevronRight, CircleDot, FileText, ReceiptText, Settings2, WalletCards } from "lucide-react";
import type { DashboardActivity, DashboardActivityPage, DashboardActivityGroup } from "@shared/agent-dashboard";
import { NeuBadge, NeuButton, NeuCard } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";

type FeedQuery = UseInfiniteQueryResult<InfiniteData<DashboardActivityPage>, Error>;

type Props = {
  query: FeedQuery;
  isLoading: boolean;
  identityError?: Error;
  onRetry: () => void;
  onNavigate: (path: string) => void;
};

const kindConfig = {
  invoice: { color: "#168f99", icon: ReceiptText, label: "Invoice" },
  status: { color: "#c7802e", icon: CircleDot, label: "Status" },
  collection: { color: "#bd685b", icon: WalletCards, label: "Collection" },
  document: { color: "#4b83aa", icon: FileText, label: "Document" },
  system: { color: "#828b87", icon: Settings2, label: "System" },
} as const;

function relativeTime(value: string | null | undefined, now: number) {
  if (!value) return "Time unavailable";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Time unavailable";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  return parts.slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function ActivitySkeleton() {
  return <div className="ff-activity-skeleton" data-testid="activity-loading" aria-label="Loading team activity">
    <div className="ff-activity-skeleton-pills">{[0, 1, 2].map(item => <span key={item} />)}</div>
    {[0, 1, 2].map(item => <div className="ff-activity-skeleton-row" key={item}><i /><span /><span /></div>)}
  </div>;
}

function ActivityError({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : "This activity feed is temporarily unavailable.";
  return <NeuNotice severity="block" role="alert" className="flex items-center justify-between gap-3">
    <div><strong>Team activity could not be loaded</strong><p>{message}</p></div>
    <NeuButton variant="accent" onClick={retry} className="!min-h-9 !px-4">Retry</NeuButton>
  </NeuNotice>;
}

function EventDetails({ group }: { group: DashboardActivityGroup }) {
  return <div className="ff-activity-details" id={`activity-details-${group.id}`}>
    <p className="ff-activity-detail-heading">{group.count} related {group.count === 1 ? "event" : "events"} in this moment</p>
    <ul>
      {group.events.map((event: DashboardActivity, index) => (
        <li key={`${event.id}-${index}`}>
          <span className="ff-activity-detail-mark" aria-hidden="true" />
          <span>{event.action}</span>
          <time dateTime={event.when ?? undefined} title={event.when ? new Date(event.when).toLocaleString() : undefined}>
            {event.when ? new Date(event.when).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "Time unavailable"}
          </time>
        </li>
      ))}
    </ul>
  </div>;
}

function ActivityItem({
  group,
  expanded,
  onToggle,
  onNavigate,
  now,
  animate,
}: {
  group: DashboardActivityGroup;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  now: number;
  animate: boolean;
}) {
  const config = kindConfig[group.kind] ?? kindConfig.system;
  const Icon = config.icon;
  const label = group.entityLabel || "Activity";
  const title = group.when ? new Date(group.when).toLocaleString() : "Time unavailable";
  const action = group.count > 1
    ? `${group.count} ${group.kind === "status" ? "status changes" : `${config.label.toLowerCase()} events`}`
    : group.action.split(" · ")[0];
  return <article className={`ff-activity-item${animate ? " is-new" : ""}`} data-testid="activity-item" data-kind={group.kind}>
      <span className="ff-activity-connector" style={{ "--activity-kind": config.color } as CSSProperties} aria-hidden="true" />
    <NeuCard className="ff-activity-event-card">
      <div className="ff-activity-event-top">
        <button
          type="button"
          className="ff-activity-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={`activity-details-${group.id}`}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${group.count} ${group.count === 1 ? "event" : "events"}: ${group.action} ${label}`}
        >
          <span className="ff-activity-avatar" aria-hidden="true">{initials(group.who)}</span>
          <span className="ff-activity-agent">{group.who || "Unknown agent"}</span>
          <span className="ff-activity-action">
            <span className="ff-activity-kind" style={{ color: config.color }}><Icon aria-hidden="true" />{config.label}</span>
            <span className="ff-activity-action-copy">{action} · <strong>{label}</strong></span>
          </span>
          {group.count > 1 && <NeuBadge className="ff-activity-count">{group.count}</NeuBadge>}
          <time className="ff-activity-time" dateTime={group.when ?? undefined} title={title}>{relativeTime(group.when, now)}</time>
          <span className="ff-activity-expand" aria-hidden="true">{expanded ? <ChevronDown /> : <ChevronRight />}</span>
        </button>
        {group.href && <button type="button" className="ff-activity-open" onClick={() => onNavigate(group.href!)} aria-label={`Open ${label}`}>
          Open <ArrowUpRight aria-hidden="true" />
        </button>}
      </div>
      {expanded && <EventDetails group={group} />}
    </NeuCard>
  </article>;
}

export function TeamActivityFeed({ query, isLoading, identityError, onRetry, onNavigate }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const [animatedIds, setAnimatedIds] = useState<Set<string>>(() => new Set());
  const firstPageBaseline = useRef<Set<string> | null>(null);
  const previousFirstPage = useRef<string | null>(null);
  const pages = query.data?.pages ?? [];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const firstPage = pages[0];
    if (!firstPage) return;
    const firstIds = new Set(firstPage.activity.map(group => String(group.id)));
    const signature = [...firstIds].join("|");
    if (firstPageBaseline.current === null) {
      firstPageBaseline.current = firstIds;
      previousFirstPage.current = signature;
      return;
    }
    if (previousFirstPage.current !== signature) {
      const newlySeen = [...firstIds].filter(id => !firstPageBaseline.current?.has(id));
      if (newlySeen.length) {
        setAnimatedIds(new Set(newlySeen));
        const timeout = window.setTimeout(() => setAnimatedIds(new Set()), 1100);
        firstPageBaseline.current = new Set([...firstPageBaseline.current, ...firstIds]);
        previousFirstPage.current = signature;
        return () => window.clearTimeout(timeout);
      }
      previousFirstPage.current = signature;
    }
  }, [pages]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    return pages.flatMap(page => page.activity).filter(group => {
      const id = String(group.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [pages]);
  const summary = pages[0]?.summary;
  const latestTime = summary?.lastActionAt;
  const lastAction = relativeTime(latestTime, now);
  const loadMoreError = query.isFetchNextPageError;

  if (isLoading) return <ActivitySkeleton />;
  if (identityError) return <ActivityError error={identityError} retry={onRetry} />;
  if (query.isError && !query.data) return <ActivityError error={query.error} retry={onRetry} />;
  if (!query.data) return <ActivitySkeleton />;

  return <div className="ff-activity-feed" data-testid="activity-feed" aria-live="polite">
    <div className="ff-activity-summary" data-testid="activity-summary" aria-label="Team activity summary">
      <div className="ff-activity-summary-pill"><span>Today (UTC)</span><strong>{summary?.todayCount.toLocaleString() ?? "—"}</strong><small>actions</small></div>
      <div className="ff-activity-summary-pill"><span>Most active</span><strong>{summary?.mostActive?.name ?? "—"}</strong><small>{summary?.mostActive ? `${summary.mostActive.count.toLocaleString()} actions` : "no activity yet"}</small></div>
      <div className="ff-activity-summary-pill"><span>Last action</span><strong>{latestTime ? lastAction : "—"}</strong><small>{latestTime ? "across the team" : "no activity yet"}</small></div>
    </div>
    {query.isError && query.data && !query.isFetchNextPageError && <NeuNotice severity="info" role="status" className="flex items-center justify-between gap-3">
      <span>Could not refresh the feed. Showing the last loaded activity.</span>
      <button type="button" onClick={onRetry}>Retry</button>
    </NeuNotice>}

    {groups.length ? <div className="ff-activity-timeline">
      {groups.map(group => <ActivityItem
        key={group.id}
        group={group}
        expanded={expanded.has(String(group.id))}
        onToggle={() => setExpanded(previous => {
          const next = new Set(previous);
          const id = String(group.id);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })}
        onNavigate={onNavigate}
        now={now}
        animate={animatedIds.has(String(group.id))}
      />)}
    </div> : <div className="ff-activity-empty"><span className="ff-activity-empty-mark"><CircleDot aria-hidden="true" /></span><strong>A quiet moment</strong><p>No recent team activity to show.</p></div>}

    {loadMoreError && <NeuNotice severity="block" role="alert" className="flex items-center justify-between gap-3">
      <span>Could not load the next activity page.</span>
      <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>Retry</button>
    </NeuNotice>}
    {query.hasNextPage && <div className="ff-activity-more">
      <NeuButton
        type="button"
        onClick={() => query.fetchNextPage()}
        disabled={query.isFetchingNextPage}
        data-testid="activity-show-more"
        className="ff-activity-more-button"
      >
        {query.isFetchingNextPage ? <><span className="ff-activity-load-shimmer" aria-hidden="true" />Loading next 10</> : loadMoreError ? "Retry loading activity" : "Show more"}
      </NeuButton>
      <span>{groups.length} events shown</span>
    </div>}
  </div>;
}
