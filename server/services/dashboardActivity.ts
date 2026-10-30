import { sql } from "drizzle-orm";
import { db } from "../db";
import type {
  DashboardActivity, DashboardActivityKind, DashboardActivityPage, DashboardViewer,
} from "../../shared/agent-dashboard";
import { dashboardQuery } from "./agentDashboardQueries";

export const ACTIVITY_PAGE_SIZE = 10;
type Cursor = { second: string; id: number };
type EventRow = {
  id: number; who: string; eventType: string; entityType: string; entityId: number;
  invoiceNumber: string | null; when: string;
};
type GroupRow = EventRow & { actorId: string | null; cursorId: number; count: number; events: EventRow[] };

export function decodeActivityCursor(value?: string): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw Error();
    const { second, id } = parsed as Record<string, unknown>;
    if (typeof second !== "string" || !Number.isSafeInteger(id) || Number(id) <= 0
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(second)
      || !Number.isFinite(Date.parse(second)) || new Date(second).toISOString() !== second) throw Error();
    return { second, id: Number(id) };
  } catch { throw new Error("Invalid activity cursor"); }
}

export function activityKind(type: string): DashboardActivityKind {
  if (/chargeback|collect/i.test(type)) return "collection";
  if (/document|upload/i.test(type)) return "document";
  if (/status|transition/i.test(type)) return "status";
  if (/invoice.*(creat|fund)|(creat|fund).*invoice/i.test(type)) return "invoice";
  return "system";
}

function utcTimestamp(value: string): string {
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`).toISOString();
}

function describe(row: EventRow): DashboardActivity {
  return {
    id: row.id, who: row.who,
    action: `${row.eventType.replace(/[_.-]/g, " ")} · ${row.entityType} ${row.invoiceNumber ?? `#${row.entityId}`}`,
    when: utcTimestamp(row.when),
    href: row.entityType === "invoice" ? `/invoices/${row.entityId}`
      : row.entityType === "client" ? `/clients/${row.entityId}`
        : row.entityType === "document" ? `/documents?documentId=${row.entityId}` : null,
  };
}

/** Same staff-only event ledger source as the existing dashboard activity query.
 * Group BEFORE LIMIT so a second's repeated actions never split across pages.
 * Summaries aggregate in SQL; only ten groups and their members leave the DB.
 * UTC day boundaries match the dashboard's existing financial reporting clock.
 */
export async function readDashboardActivityPage(
  viewer: DashboardViewer, store = db, now = new Date(), options: { cursor?: string } = {},
): Promise<DashboardActivityPage> {
  const cursor = decodeActivityCursor(options.cursor);
  const result = await dashboardQuery("activity", "paginated-staff-timeline", store.execute<{
    groups: GroupRow[]; summary: DashboardActivityPage["summary"];
  }>(sql`
    WITH eligible AS MATERIALIZED (
      SELECT l.id,l.event_type,l.entity_type,l.entity_id,l.actor_id,l.created_at,
        date_trunc('second',l.created_at) AS second,
        coalesce(nullif(trim(concat_ws(' ',u.first_name,u.last_name)),''),'Staff member') AS who,
        i.invoice_number
      FROM event_ledger l LEFT JOIN users u ON u.id=l.actor_id
      LEFT JOIN invoices i ON l.entity_type='invoice' AND i.id=l.entity_id
      WHERE l.actor_type='user' AND l.actor_id IS NOT NULL
        AND (u.id IS NULL OR u.is_test_account=false)
    ), grouped AS (
      SELECT second,actor_id,event_type,entity_type,entity_id,
        min(id) AS id,max(id) AS cursor_id,count(*)::int AS count
      FROM eligible
      ${cursor ? sql`WHERE second<=${cursor.second}::timestamptz AT TIME ZONE 'UTC'` : sql``}
      GROUP BY second,actor_id,event_type,entity_type,entity_id
      ${cursor ? sql`HAVING second<${cursor.second}::timestamptz AT TIME ZONE 'UTC' OR max(id)<${cursor.id}` : sql``}
      ORDER BY second DESC,max(id) DESC LIMIT ${ACTIVITY_PAGE_SIZE + 1}
    ), today AS (
      SELECT * FROM eligible
      WHERE created_at>=date_trunc('day',${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        AND created_at<date_trunc('day',${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')+interval '1 day'
    )
    SELECT coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',g.id,'cursorId',g.cursor_id,'actorId',g.actor_id,'eventType',g.event_type,
      'entityType',g.entity_type,'entityId',g.entity_id,'count',g.count,'when',g.second,
      'who',e.who,'invoiceNumber',e.invoice_number,
      'events',(SELECT jsonb_agg(jsonb_build_object('id',m.id,'who',m.who,
        'eventType',m.event_type,'entityType',m.entity_type,'entityId',m.entity_id,
        'invoiceNumber',m.invoice_number,'when',m.created_at) ORDER BY m.created_at DESC,m.id DESC)
        FROM eligible m WHERE m.second=g.second AND m.actor_id=g.actor_id
          AND m.event_type=g.event_type AND m.entity_type=g.entity_type AND m.entity_id=g.entity_id)
    ) ORDER BY g.second DESC,g.cursor_id DESC) FROM grouped g JOIN eligible e ON e.id=g.id),'[]') AS groups,
    jsonb_build_object(
      'todayCount',(SELECT count(*)::int FROM today),
      'mostActive',(SELECT jsonb_build_object('name',min(who),'count',count(*)::int)
        FROM today GROUP BY actor_id ORDER BY count(*) DESC,min(who),actor_id LIMIT 1),
      'lastActionAt',(SELECT max(created_at) FROM eligible)
    ) AS summary
  `));
  const { groups, summary } = result.rows[0];
  const selected = groups.slice(0, ACTIVITY_PAGE_SIZE);
  const last = selected.at(-1);
  return {
    viewer, generatedAt: now.toISOString(), limit: ACTIVITY_PAGE_SIZE,
    summary: { ...summary, lastActionAt: summary.lastActionAt ? utcTimestamp(summary.lastActionAt) : null },
    nextCursor: groups.length > ACTIVITY_PAGE_SIZE && last
      ? Buffer.from(JSON.stringify({ second: utcTimestamp(last.when), id: last.cursorId })).toString("base64url") : null,
    activity: selected.map(group => ({
      ...describe(group), actorId: group.actorId, kind: activityKind(group.eventType),
      entityLabel: `${group.entityType} ${group.invoiceNumber ?? `#${group.entityId}`}`,
      count: group.count, events: group.events.map(describe),
    })),
  };
}
