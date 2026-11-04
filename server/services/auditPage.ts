import { sql } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { db } from "../db";

export const auditPageFilters = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(DEFAULT_PAGE_SIZE),
  entityType: z.string().max(100).optional(),
  action: z.string().max(200).optional(),
  actor: z.string().max(200).optional(),
  q: z.string().trim().max(300).optional(),
  days: z.coerce.number().positive().max(36500).optional(),
});
/** Filtering, counts and filter choices precede pagination; exports traverse the same 15-row pages. */
export async function readAuditPage(input: unknown) {
  const f = auditPageFilters.parse(input);
  const conditions = [sql`true`];
  if (f.entityType && f.entityType !== "all") conditions.push(sql`entity_type::text = ${f.entityType}`);
  if (f.action && f.action !== "all") conditions.push(sql`event_type = ${f.action}`);
  if (f.actor && f.actor !== "all") conditions.push(sql`coalesce(actor_name, actor_id, actor_type) = ${f.actor}`);
  if (f.days) conditions.push(sql`created_at >= now() - ${f.days} * interval '1 day'`);
  if (f.q) {
    const term = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(sql`concat_ws(' ', replace(event_type, '_', ' '), entity_type, '#' || entity_id,
      actor_name, actor_id, actor_type, payload_json::text) ILIKE ${term}`);
  }
  const result = await db.execute(sql`
    WITH source AS MATERIALIZED (
      SELECT e.*, CASE WHEN e.actor_type = 'user' THEN
        (SELECT concat(first_name, ' ', last_name) FROM users WHERE id = e.actor_id) ELSE NULL END AS actor_name
      FROM event_ledger e
    ), filtered AS MATERIALIZED (
      SELECT * FROM source WHERE ${sql.join(conditions, sql` AND `)}
    ), page AS (
      SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}
    )
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'entityType', p.entity_type, 'entityId', p.entity_id, 'eventType', p.event_type,
        'actorType', p.actor_type, 'actorId', p.actor_id, 'actorName', p.actor_name,
        'payloadJson', p.payload_json, 'createdAt', to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) ORDER BY p.created_at DESC, p.id DESC) FROM page p), '[]'::jsonb) AS rows,
      jsonb_build_object(
        'entities', coalesce((SELECT jsonb_agg(x.v ORDER BY x.v) FROM (SELECT DISTINCT entity_type::text AS v FROM source) x), '[]'::jsonb),
        'actions', coalesce((SELECT jsonb_agg(x.v ORDER BY x.v) FROM (SELECT DISTINCT event_type AS v FROM source) x), '[]'::jsonb),
        'actors', coalesce((SELECT jsonb_agg(x.v ORDER BY x.v) FROM (SELECT DISTINCT coalesce(actor_name, actor_id, actor_type) AS v FROM source) x), '[]'::jsonb)
      ) AS options
  `);
  return { ...(result.rows[0] as { total: number; rows: unknown[]; options: { entities: string[]; actions: string[]; actors: string[] } }), limit: f.limit };
}
