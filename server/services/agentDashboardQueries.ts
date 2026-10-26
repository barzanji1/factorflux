import { performance } from "node:perf_hooks";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { users, invoices, eventLedger } from "../../shared/schema";
import type {
  DashboardViewer, DashboardSection, DashboardQueue, DashboardFollowUps, DashboardActivityFeed,
  DashboardAlerts, DashboardQueueGroup,
} from "../../shared/agent-dashboard";
import type { InvoicePreflightAlert } from "./invoicePreflight";
import { dashboardPreflights } from "./dashboardPreflight";
import { invoiceWork, unacknowledgedCodes } from "./agentDashboardWork";

export const DASHBOARD_LIMIT = 20;
type Store = typeof db;
export async function dashboardQuery<T>(section: DashboardSection, label: string, work: PromiseLike<T>): Promise<T> {
  const start = performance.now();
  let ok = false;
  try { const result = await work; ok = true; return result; }
  finally { console.info(`[agent-dashboard] section=${section} query=${label} duration_ms=${(performance.now() - start).toFixed(1)} ok=${ok}`); }
}
const meta = (viewer: DashboardViewer, now: Date) => ({ viewer, generatedAt: now.toISOString() });
const staffName = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(" ") || "Staff member";
type QueueSource = {
  id: number; invoiceNumber: string; status: string; clientId: number; brokerId: number | null; loadNumber: string | null;
  amount: string; applied: string; createdAt: string | null; fundedAt: string | null; brokerConfirmationStatus: string;
  agentId: string | null; carrierName: string; brokerName: string | null; failedOcr: boolean;
  snapshot: { alerts?: InvoicePreflightAlert[]; acknowledgements?: { code: string }[] } | null;
  ackCodes: string[]; notices: { severity: string; code: string; message?: string }[];
};

export async function readDashboardQueue(viewer: DashboardViewer, store: Store = db, now = new Date()): Promise<DashboardQueue> {
  const manager = viewer.role !== "employee";
  const scope = manager ? sql`true` : sql`coalesce(i.assigned_to,c.assigned_processor,i.submitted_by) = ${viewer.id}`;
  const [staff, data] = await Promise.all([
    dashboardQuery("queue", "staff", store.select({ id: users.id, first: users.firstName, last: users.lastName }).from(users)
      .where(manager ? and(eq(users.status, "active"), eq(users.isTestAccount, false)) : eq(users.id, viewer.id))
      .orderBy(users.firstName, users.lastName, users.id)),
    dashboardQuery("queue", "bounded-invoices-and-counts", store.execute<{
      items: QueueSource[]; counts: { agentId: string | null; totalCount: number }[];
    }>(sql`
      WITH source AS (
        SELECT i.id,i.invoice_number AS "invoiceNumber",i.status,i.client_id AS "clientId",i.broker_id AS "brokerId",
          i.load_number AS "loadNumber",i.amount::text,i.created_at AS "createdAt",i.funded_at AS "fundedAt",
          i.broker_confirmation_status AS "brokerConfirmationStatus",
          coalesce(i.assigned_to,c.assigned_processor,i.submitted_by) AS "agentId",
          c.name AS "carrierName",b.name AS "brokerName",s.snapshot,
          coalesce((SELECT sum(p.applied_amount+CASE WHEN p.variance_type='write_off' THEN abs(coalesce(p.variance,0)) ELSE 0 END)
            FROM payment_application_lines p WHERE p.invoice_id=i.id),0)::text AS applied,
          EXISTS(SELECT 1 FROM documents d LEFT JOIN LATERAL
            (SELECT j.status FROM doc_extraction_jobs j WHERE j.document_id=d.id ORDER BY j.id DESC LIMIT 1) j ON true
            WHERE d.invoice_id=i.id AND (j.status='failed' OR (j.status IS NULL AND d.status='failed'))) AS "failedOcr",
          coalesce((SELECT jsonb_agg(a.alert_code) FROM invoice_alert_acks a
            WHERE a.invoice_id=i.id AND a.acked_at>=s.created_at),'[]') AS "ackCodes",
          coalesce((SELECT jsonb_agg(n.meta) FROM (
            SELECT DISTINCT ON (meta->>'code') meta FROM (
              SELECT CASE WHEN pg_input_is_valid(metadata,'jsonb') THEN metadata::jsonb ELSE '{}'::jsonb END AS meta,id
              FROM notifications WHERE entity_type='invoice' AND entity_id=i.id) raw
            WHERE meta->>'severity'='ack' AND jsonb_typeof(meta->'code')='string'
              AND meta->'acknowledged' IS DISTINCT FROM 'true'::jsonb
            ORDER BY meta->>'code',id) n),'[]') AS notices
        FROM invoices i JOIN clients c ON c.id=i.client_id LEFT JOIN brokers b ON b.id=i.broker_id
        LEFT JOIN LATERAL (SELECT created_at,jsonb_build_object('alerts',payload_json->'alerts',
            'acknowledgements',payload_json->'acknowledgements') AS snapshot
          FROM event_ledger WHERE entity_type='invoice' AND entity_id=i.id AND event_type='invoice_preflight'
          ORDER BY created_at DESC,id DESC LIMIT 1) s ON true
        WHERE i.status NOT IN ('paid','settled') AND ${scope}
      ), prepared AS (
        SELECT *,CASE WHEN jsonb_typeof(snapshot->'alerts')='array' THEN snapshot->'alerts' ELSE '[]'::jsonb END AS saved_alerts,
          CASE WHEN jsonb_typeof(snapshot->'acknowledgements')='array' THEN snapshot->'acknowledgements' ELSE '[]'::jsonb END AS saved_acks
        FROM source
      ), actionable AS (
        SELECT * FROM prepared p WHERE status<>'funded'
          OR ((amount::numeric-applied::numeric)>0 AND (status IN ('funded','held')) AND
            ("brokerConfirmationStatus" IN ('pending','sent','disputed') OR "fundedAt"<=${new Date(now.getTime() - 30 * 86_400_000)}))
          OR "failedOcr"
          OR EXISTS (
            SELECT 1 FROM (SELECT DISTINCT ON (a->>'code') a,position
              FROM jsonb_array_elements(saved_alerts) WITH ORDINALITY AS t(a,position)
              ORDER BY a->>'code',position DESC) latest
            WHERE a->>'severity'='ack' AND (
              a->>'message' IS DISTINCT FROM (SELECT original->>'message' FROM jsonb_array_elements(saved_alerts)
                WITH ORDINALITY AS t(original,position) WHERE original->>'code'=a->>'code' ORDER BY position LIMIT 1)
              OR NOT (EXISTS (SELECT 1 FROM jsonb_array_elements(saved_acks) ack WHERE ack->>'code'=a->>'code')
                OR "ackCodes" ? (a->>'code'))))
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(notices) n
            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(saved_alerts) a WHERE a->>'code'=n->>'code'))
      ), ranked AS (
        SELECT *,row_number() OVER(PARTITION BY "agentId" ORDER BY coalesce("fundedAt","createdAt") ASC NULLS LAST,id) AS rank
        FROM actionable
      )
      SELECT coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',id,'invoiceNumber',"invoiceNumber",'status',status,'clientId',"clientId",'brokerId',"brokerId",
        'loadNumber',"loadNumber",'amount',amount,'applied',applied,'createdAt',"createdAt",'fundedAt',"fundedAt",
        'brokerConfirmationStatus',"brokerConfirmationStatus",'agentId',"agentId",'carrierName',"carrierName",
        'brokerName',"brokerName",'failedOcr',"failedOcr",'snapshot',snapshot,'ackCodes',"ackCodes",'notices',notices)
        ORDER BY "agentId",rank) FROM ranked WHERE rank<=${DASHBOARD_LIMIT}),'[]') AS items,
        coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
          SELECT "agentId",count(*)::int AS "totalCount" FROM actionable GROUP BY "agentId") t),'[]') AS counts`)),
  ]);
  const selected = data.rows[0]?.items ?? [], counts = data.rows[0]?.counts ?? [];
  const unfunded = selected.filter(row => !row.fundedAt);
  const preflights = await dashboardPreflights(unfunded.map(row => ({
    carrierId: row.clientId, brokerId: row.brokerId, invoiceNumber: row.invoiceNumber,
    loadNumber: row.loadNumber, amount: row.amount, excludeInvoiceId: row.id,
  })), store, (label, work) => dashboardQuery("queue", label, work));
  const byInvoice = new Map(unfunded.map((row, index) => [row.id, preflights[index].alerts]));
  const groups = new Map<string | null, DashboardQueueGroup>(staff.map(person => [person.id, {
    agentId: person.id, agentName: staffName(person.first, person.last), items: [], totalCount: 0,
  }]));
  for (const count of counts) {
    if (!groups.has(count.agentId)) groups.set(count.agentId, { agentId: count.agentId,
      agentName: count.agentId ? "Inactive / former staff" : "Unassigned", items: [], totalCount: 0 });
    groups.get(count.agentId)!.totalCount = count.totalCount;
  }
  for (const row of selected) {
    const current = [...(byInvoice.get(row.id) ?? [])];
    const saved = Array.isArray(row.snapshot?.alerts) ? row.snapshot!.alerts! : [];
    for (const notice of row.notices) if (!current.some(a => a.code === notice.code) && !saved.some(a => a.code === notice.code))
      current.push({ code: notice.code, severity: "ack", title: "Preflight alert", message: String(notice.message ?? notice.code) });
    const work = invoiceWork({ ...row, createdAt: row.createdAt ? new Date(row.createdAt) : null,
      fundedAt: row.fundedAt ? new Date(row.fundedAt) : null, outstanding: Math.max(0, Number(row.amount) - Number(row.applied)) },
    row.failedOcr, unacknowledgedCodes(row.snapshot, current, new Set(row.ackCodes)), now, manager);
    for (const alert of current.filter(alert => alert.severity === "block")) work.actions.push(`Preflight blocked: ${alert.title}`);
    if (!work.actions.length) continue;
    groups.get(row.agentId)!.items.push({ id: row.id, invoiceNumber: row.invoiceNumber, carrierName: row.carrierName,
      brokerName: row.brokerName ?? "No broker assigned", status: row.status, ...work, href: `/invoices/${row.id}` });
  }
  return { ...meta(viewer, now), queueGroups: [...groups.values()], queueCount: counts.reduce((sum, row) => sum + row.totalCount, 0), limit: DASHBOARD_LIMIT };
}

export async function readDashboardFollowUps(viewer: DashboardViewer, store: Store = db, now = new Date()): Promise<DashboardFollowUps> {
  const result = await dashboardQuery("followups", "bounded-followups-and-count", store.execute<{
    items: DashboardFollowUps["followUps"]; total: number;
  }>(sql`
    WITH open_followups AS (
      SELECT 'task:'||t.id AS id,'task' AS source,t.title,c.name AS "carrierName",t.status,t.priority,t.due_date AS "dueDate",
        CASE WHEN t.confirmation_invoice_id IS NOT NULL THEN '/invoices/'||t.confirmation_invoice_id ELSE '/tasks?taskId='||t.id END AS href
      FROM tasks t LEFT JOIN clients c ON c.id=t.client_id WHERE t.assigned_to=${viewer.id} AND t.status<>'completed'
        AND (t.type IN ('followup','call') OR t.confirmation_invoice_id IS NOT NULL)
      UNION ALL
      SELECT 'follow_up:'||f.id,'follow_up',f.title,c.name,f.status,f.priority,f.due_date,'/follow-up?followupId='||f.id
      FROM follow_ups f JOIN clients c ON c.id=f.client_id WHERE c.assigned_processor=${viewer.id} AND f.status<>'completed'
      UNION ALL
      SELECT 'broker_follow_up:'||f.id,'broker_follow_up',f.subject,c.name,f.status,'medium',
        coalesce((SELECT min(r.scheduled_send_at) FROM broker_follow_up_reminders r
          WHERE r.follow_up_id=f.id AND r.status IN ('scheduled','sending')),f.created_at),'/invoices/'||i.id
      FROM broker_follow_ups f JOIN invoices i ON i.id=f.invoice_id JOIN clients c ON c.id=i.client_id
      WHERE f.status<>'acknowledged' AND coalesce(i.assigned_followup_agent_id,i.assigned_to,c.assigned_processor,i.submitted_by)=${viewer.id}
    )
    SELECT (SELECT count(*)::int FROM open_followups) AS total,
      coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY "dueDate" ASC NULLS LAST,id)
        FROM (SELECT * FROM open_followups ORDER BY "dueDate" ASC NULLS LAST,id LIMIT ${DASHBOARD_LIMIT}) t),'[]') AS items`));
  return { ...meta(viewer, now), followUps: result.rows[0]?.items ?? [], totalCount: result.rows[0]?.total ?? 0, limit: DASHBOARD_LIMIT };
}
export async function readDashboardActivity(viewer: DashboardViewer, store: Store = db, now = new Date()): Promise<DashboardActivityFeed> {
  const rows = await dashboardQuery("activity", "recent-staff-events", store.select({
    id: eventLedger.id, type: eventLedger.eventType, entityType: eventLedger.entityType, entityId: eventLedger.entityId,
    when: eventLedger.createdAt, first: users.firstName, last: users.lastName, invoiceNumber: invoices.invoiceNumber,
  }).from(eventLedger).leftJoin(users, eq(eventLedger.actorId, users.id))
    .leftJoin(invoices, and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.entityId, invoices.id)))
    .where(and(eq(eventLedger.actorType, "user"), isNotNull(eventLedger.actorId), or(isNull(users.id), eq(users.isTestAccount, false))))
    .orderBy(desc(eventLedger.createdAt), desc(eventLedger.id)).limit(DASHBOARD_LIMIT));
  return { ...meta(viewer, now), activity: rows.map(row => ({
    id: row.id, who: staffName(row.first, row.last),
    action: `${row.type.replace(/[_.-]/g, " ")} · ${row.entityType} ${row.invoiceNumber ?? `#${row.entityId}`}`,
    when: row.when?.toISOString() ?? null,
    href: row.entityType === "invoice" ? `/invoices/${row.entityId}` : row.entityType === "client" ? `/clients/${row.entityId}`
      : row.entityType === "document" ? `/documents?documentId=${row.entityId}` : null,
  })) };
}
export async function readDashboardAlerts(viewer: DashboardViewer, store: Store = db, now = new Date()): Promise<DashboardAlerts> {
  const result = await dashboardQuery("alerts", "bounded-alerts-and-counts", store.execute<{
      alerts: DashboardAlerts["alerts"]; counts: DashboardAlerts["alertCounts"];
    }>(sql`
      WITH active_alerts AS (
        SELECT 'email:'||e.id AS id,'email_bounced' AS kind,'Bounced email: '||e.subject AS title,
          array_to_string(e.to_addresses,', ')||' — '||coalesce(e.error,'Check the recipient address.') AS detail,
          e.status_updated_at AS "when",'/email-log?emailId='||e.id AS href FROM email_log e WHERE e.status='bounced'
        UNION ALL
        SELECT 'document:'||d.id,'ocr_failed','Document extraction failed: '||d.original_name,
          coalesce(j.error_message,'Open Documents and retry extraction.'),coalesce(j.created_at,d.created_at),'/documents?documentId='||d.id
        FROM documents d LEFT JOIN LATERAL (SELECT status,error_message,created_at FROM doc_extraction_jobs j
          WHERE j.document_id=d.id ORDER BY j.id DESC LIMIT 1) j ON true
        WHERE j.status='failed' OR (j.status IS NULL AND d.status='failed')
      )
      SELECT jsonb_build_object('email_bounced',count(*) FILTER(WHERE kind='email_bounced'),
        'ocr_failed',count(*) FILTER(WHERE kind='ocr_failed')) AS counts,
        coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY "when" DESC NULLS LAST,id)
          FROM (SELECT * FROM active_alerts ORDER BY "when" DESC NULLS LAST,id LIMIT ${DASHBOARD_LIMIT}) t),'[]') AS alerts
      FROM active_alerts`));
  return { ...meta(viewer, now), alerts: result.rows[0].alerts, alertCounts: result.rows[0].counts };
}
