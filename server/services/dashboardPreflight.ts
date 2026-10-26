import { sql } from "drizzle-orm";
import { db } from "../db";
import { readSettings, runInvoicePreflight, type DashboardPreflightContext, type InvoicePreflightInput } from "./invoicePreflight";

type Lookup = Omit<DashboardPreflightContext, "settings" | "now" | "lastProcessed"> & { lastProcessed: Date | string | null; index: number };
export async function dashboardPreflights(inputs: Omit<InvoicePreflightInput, "serviceDate">[], store = db,
  timed: <T>(label: string, work: PromiseLike<T>) => Promise<T> = async (_label, work) => work) {
  if (!inputs.length) return [];
  const now = new Date();
  const [settings, data] = await Promise.all([
    timed("preflight-settings", readSettings(store)),
    timed("preflight-batch", store.execute<Lookup>(sql`
      WITH input AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(inputs.map((value, index) => ({ ...value, index })))}::jsonb)
        AS x(index int, "carrierId" int, "brokerId" int, "invoiceNumber" text, "loadNumber" text, "excludeInvoiceId" int))
      SELECT x.index,
        (SELECT jsonb_build_object('id',c.id,'name',c.name) FROM clients c WHERE c.id=x."carrierId") AS carrier,
        (SELECT jsonb_build_object('id',b.id,'creditGrade',b.credit_grade) FROM brokers b WHERE b.id=x."brokerId") AS broker,
        (SELECT max(coalesce(i.approved_at,i.funded_at,i.submitted_at,i.created_at)) FROM invoices i
          WHERE i.client_id=x."carrierId" AND i.status IN ('approved','funded','settled','paid')) AS "lastProcessed",
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'carrierInvoiceNumber',i.carrier_invoice_number,'loadNumber',i.load_number))
          FROM invoices i WHERE i.client_id=x."carrierId"
            AND ((nullif(x."invoiceNumber",'') IS NOT NULL AND i.carrier_invoice_number=x."invoiceNumber")
              OR (nullif(x."loadNumber",'') IS NOT NULL AND i.load_number=x."loadNumber"))
            AND (x."excludeInvoiceId" IS NULL OR i.id<>x."excludeInvoiceId")), '[]') AS "exactMatches",
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'severity',a.severity,'title',a.title,'message',a.message))
          FROM carrier_alerts a WHERE a.entity_type='carrier' AND a.entity_id=x."carrierId" AND a.active
          AND (a.expires_at IS NULL OR a.expires_at>${now})), '[]') AS "manualCarrier",
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'severity',a.severity,'title',a.title,'message',a.message))
          FROM carrier_alerts a WHERE a.entity_type='broker' AND a.entity_id=x."brokerId" AND a.active
          AND (a.expires_at IS NULL OR a.expires_at>${now})), '[]') AS "manualBroker",
        (SELECT jsonb_build_object('id',i.id,'invoiceNumber',i.invoice_number) FROM invoices i
          WHERE i.broker_id=x."brokerId" AND i.status IN ('funded','held')
          AND i.broker_confirmation_status IN ('pending','sent','disputed') AND i.funded_at IS NOT NULL
          AND coalesce(i.confirmation_sent_at,i.funded_at)<=${new Date(now.getTime() - 14 * 86_400_000)}
          AND (x."excludeInvoiceId" IS NULL OR i.id<>x."excludeInvoiceId") LIMIT 1) AS unconfirmed,
        (SELECT jsonb_build_object('id',i.id) FROM invoices i WHERE i.broker_id=x."brokerId"
          AND i.chargeback_status IN ('scheduled','extended') LIMIT 1) AS "brokerChargeback",
        (SELECT jsonb_build_object('id',i.id) FROM invoices i WHERE i.client_id=x."carrierId"
          AND i.chargeback_status IN ('scheduled','extended') LIMIT 1) AS "carrierChargeback",
        (SELECT to_jsonb(a) FROM (SELECT authority_status AS "authorityStatus",check_status AS "checkStatus",
          allowed_to_operate AS "allowedToOperate",operating_status AS "operatingStatus",
          common_authority_status AS "commonAuthorityStatus",contract_authority_status AS "contractAuthorityStatus",
          broker_authority_status AS "brokerAuthorityStatus" FROM broker_authority_checks
          WHERE entity_type='broker' AND entity_id=x."brokerId" ORDER BY checked_at DESC LIMIT 1) a) AS "brokerAuthority",
        (SELECT to_jsonb(a) FROM (SELECT authority_status AS "authorityStatus",check_status AS "checkStatus"
          FROM carrier_authority_checks WHERE carrier_id=x."carrierId" ORDER BY checked_at DESC LIMIT 1) a) AS "carrierAuthority",
        coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT id,notes FROM broker_authority_alerts
          WHERE entity_type='broker' AND entity_id=x."brokerId" AND alert_type='insurance_lapsed' AND resolved_at IS NULL LIMIT 10) a), '[]')
          AS "expiredInsuranceAlerts"
      FROM input x ORDER BY x.index`)),
  ]);
  const rows = new Map(data.rows.map(row => [row.index, row]));
  return Promise.all(inputs.map((input, index) => {
    const row = rows.get(index);
    if (!row) throw new Error("Dashboard preflight lookup missing.");
    return runInvoicePreflight(input, store, { ...row, settings, now,
      lastProcessed: row.lastProcessed ? new Date(row.lastProcessed) : null });
  }));
}
