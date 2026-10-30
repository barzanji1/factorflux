import { sql } from "drizzle-orm";
import { db } from "../db";
import { buildBrokerFinancialSummary, type BrokerCreditPoint } from "../../shared/broker-financial";
import type { CarrierFinancialInvoice, CarrierFinancialPayment } from "../../shared/carrier-financial";
import { fundedAgeDays } from "./brokerConfirmationService";

interface SummaryProjection {
  invoiceRows: CarrierFinancialInvoice[];
  payments: CarrierFinancialPayment[];
  receivables: { outstanding: number; fundedAt: string }[];
  creditHistory: BrokerCreditPoint[];
}

/** One SQL statement supplies a consistent, broker-scoped snapshot for every chart. */
export async function readBrokerFinancial(brokerId: number, creditGrade: string | null, now = new Date()) {
  const result = await db.execute(sql`
    WITH scoped AS (
      SELECT id, amount, status, invoice_date AS "invoiceDate", created_at AS "createdAt",
        funded_at AS "fundedAt", load_type AS "loadType", chargeback_status AS "chargebackStatus"
      FROM invoices WHERE broker_id = ${brokerId}
    ), payments AS (
      SELECT p.invoice_id AS "invoiceId", p.applied_amount AS amount, a.payment_date AS "paymentDate"
      FROM payment_application_lines p
      JOIN scoped i ON i.id = p.invoice_id
      JOIN cash_applications a ON a.id = p.cash_application_id
      WHERE a.payment_date <= ${now}
    ), applied AS (
      SELECT p.invoice_id,
        sum(p.applied_amount + CASE WHEN p.variance_type = 'write_off' THEN abs(coalesce(p.variance, 0)) ELSE 0 END) AS settled
      FROM payment_application_lines p JOIN scoped i ON i.id = p.invoice_id
      GROUP BY p.invoice_id
    ), receivables AS (
      SELECT i."fundedAt", greatest(0, i.amount - coalesce(a.settled, 0)) AS outstanding
      FROM scoped i LEFT JOIN applied a ON a.invoice_id = i.id
      WHERE i."fundedAt" IS NOT NULL AND i."fundedAt" <= ${now}
        AND i.status IN ('funded', 'held') AND i.amount - coalesce(a.settled, 0) > 0
    ), credit_history AS (
      SELECT grade, score, last_calculated_at AS "calculatedAt"
      FROM broker_credit_scores
      WHERE broker_id = ${brokerId} AND last_calculated_at <= ${now}
        AND last_calculated_at >= ${now}::timestamp - interval '12 months'
      ORDER BY last_calculated_at DESC, id DESC LIMIT 500
    )
    SELECT
      coalesce((SELECT jsonb_agg(i) FROM scoped i), '[]'::jsonb) AS "invoiceRows",
      coalesce((SELECT jsonb_agg(p) FROM payments p), '[]'::jsonb) AS payments,
      coalesce((SELECT jsonb_agg(r) FROM receivables r), '[]'::jsonb) AS receivables,
      coalesce((SELECT jsonb_agg(c) FROM credit_history c), '[]'::jsonb) AS "creditHistory"
  `);
  const row = result.rows[0] as unknown as SummaryProjection;
  return buildBrokerFinancialSummary(
    row.invoiceRows, row.payments,
    row.receivables.map(value => ({ outstanding: Number(value.outstanding), ageDays: fundedAgeDays(new Date(value.fundedAt), now) })),
    row.creditHistory, creditGrade, now,
  );
}
