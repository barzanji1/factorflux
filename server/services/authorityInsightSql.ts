import { sql } from "drizzle-orm";

// Each current directory entity contributes once. Latest evidence, not all
// historical check rows, determines the status. Never used by dashboard alerts.
export const authorityInsightCte = sql`, authority_entities AS MATERIALIZED (
  SELECT coalesce(c.authority_status,'UNKNOWN') AS authority FROM brokers b
  LEFT JOIN LATERAL (SELECT authority_status FROM broker_authority_checks
    WHERE entity_type='broker' AND entity_id=b.id ORDER BY checked_at DESC,id DESC LIMIT 1) c ON true
  UNION ALL
  SELECT coalesce(c.authority_status,'UNKNOWN') AS authority FROM clients b
  LEFT JOIN LATERAL (SELECT authority_status FROM carrier_authority_checks
    WHERE carrier_id=b.id ORDER BY checked_at DESC,id DESC LIMIT 1) c ON true
)`;
