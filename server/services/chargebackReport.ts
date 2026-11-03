import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  chargebackReportFiltersSchema, type ChargebackReport,
  type ChargebackReportRow, type ChargebackReportSection, type ChargebackReportTotals,
} from "../../shared/chargeback-report";

type Store = Pick<typeof db, "execute">;
const sections: ChargebackReportSection[] = ["chargebacks", "shortPays", "deductions"];
const emptyTotals = (): ChargebackReportTotals => ({
  count: 0, originalAmount: 0, cashApplied: 0, amount: 0, outstanding: 0, unknownAmounts: 0,
  refunded: 0, collected: 0, writtenOff: 0, recovered: 0, netOutstanding: 0, byType: {},
});
function cents(value: unknown): number {
  const text = String(value ?? "0");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Invalid monetary value in chargeback report.");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const result = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * (text.startsWith("-") ? -1 : 1);
  if (!Number.isSafeInteger(result)) throw new Error("Report monetary value exceeds safe precision.");
  return result;
}
function sumMoney(total: number, value: number): number {
  const result = Math.round(total * 100) + Math.round(value * 100);
  if (!Number.isSafeInteger(result)) throw new Error("Report total exceeds safe precision.");
  return result / 100;
}

/** A single SQL statement gives all three sections one consistent snapshot.
 * Date range applies to the section's event date, not invoice creation date.
 * PostgreSQL numeric arithmetic is retained until the final JSON conversion.
 */
export async function buildChargebackReport(input: unknown, store: Store = db): Promise<ChargebackReport> {
  const filters = chargebackReportFiltersSchema.parse(input);
  const result = await store.execute(sql`
    WITH scoped AS (
      SELECT i.*, c.name AS carrier_name,
        coalesce(b.name, d.name, 'Not recorded') AS broker_name
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      LEFT JOIN brokers b ON b.id = i.broker_id
      LEFT JOIN debtors d ON d.id = i.debtor_id
      WHERE true
        ${filters.carrierId ? sql`AND i.client_id = ${filters.carrierId}` : sql``}
        ${filters.brokerId ? sql`AND i.broker_id = ${filters.brokerId}` : sql``}
        ${filters.invoiceId ? sql`AND i.id = ${filters.invoiceId}` : sql``}
    ), with_chargeback AS (
      SELECT s.*, coalesce(e.at, s.chargeback_date) AS charged_at,
        coalesce(nullif(e.reason, ''), 'Reason not recorded') AS charged_reason,
        CASE WHEN e.amount ~ '^[0-9]+([.][0-9]{1,2})?$' THEN e.amount::numeric ELSE null END AS recorded_chargeback
      FROM scoped s
      LEFT JOIN LATERAL (
        SELECT at, reason, amount FROM (
          SELECT l.created_at AS at,
            coalesce(l.payload_json->>'reason',
              CASE WHEN l.payload_json->>'days' IS NOT NULL
                THEN 'Automatic ' || (l.payload_json->>'days') || '-day chargeback' END) AS reason,
            coalesce(l.payload_json->>'chargebackAmount', l.payload_json->>'chargeback_amount', l.payload_json->>'amount') AS amount,
            'ledger/' || l.id::text AS source
          FROM event_ledger l WHERE l.entity_type = 'invoice' AND l.entity_id = s.id
            AND l.event_type = 'chargeback_applied'
          UNION ALL
          SELECT h.created_at, h.reason,
            coalesce(h.metadata->>'chargebackAmount', h.metadata->>'chargeback_amount', h.metadata->>'amount'),
            'history/' || h.id::text
          FROM invoice_chargeback_events h WHERE h.invoice_id = s.id
            AND h.event_type IN ('charged', 'applied', 'chargeback_applied')
        ) events ORDER BY at, source LIMIT 1
      ) e ON s.chargeback_status = 'charged'
    ), paid AS (
      SELECT p.invoice_id, sum(p.applied_amount) AS cash,
        sum(CASE WHEN p.variance_type = 'write_off' THEN abs(coalesce(p.variance, 0)) ELSE 0 END) AS written_off,
        max(coalesce(a.payment_date, p.created_at)) AS last_payment,
        sum(p.applied_amount + CASE WHEN p.variance_type = 'write_off'
          THEN abs(coalesce(p.variance, 0)) ELSE 0 END)
          FILTER (WHERE coalesce(a.payment_date, p.created_at) <= s.charged_at) AS before_chargeback
      FROM payment_application_lines p
      JOIN with_chargeback s ON s.id = p.invoice_id
      LEFT JOIN cash_applications a ON a.id = p.cash_application_id
      GROUP BY p.invoice_id
    ), balances AS (
      SELECT s.*, coalesce(p.cash, 0) AS cash, coalesce(p.written_off, 0) AS written_off,
        p.last_payment, coalesce(p.before_chargeback, 0) AS before_chargeback,
        CASE WHEN s.status IN ('paid','settled') THEN 0
          ELSE greatest(0, s.amount - coalesce(p.cash,0) - coalesce(p.written_off,0)) END AS outstanding
      FROM with_chargeback s LEFT JOIN paid p ON p.invoice_id = s.id
    ), refunds AS (
      SELECT invoice_id,sum(amount) AS refunded,max(refund_date) AS refund_date,
        string_agg(reference,', ' ORDER BY refund_date,id) AS reference
      FROM invoice_refunds GROUP BY invoice_id
    ), resolutions AS (
      SELECT invoice_id,(array_agg(original_short_pay ORDER BY id))[1] AS original_short_pay,
        sum(amount) FILTER (WHERE kind='recovered') AS recovered,
        sum(amount) FILTER (WHERE kind='written_off') AS written_off,
        max(resolution_date) AS resolution_date,
        string_agg(reference,', ' ORDER BY resolution_date,id) AS reference
      FROM short_pay_resolutions GROUP BY invoice_id
    ), entries AS (
      SELECT 'chargeback/' || s.id::text AS id, 'chargebacks' AS section, s.id AS invoice_id, s.charged_at AS date,
        s.amount AS original_amount, s.cash AS cash_applied,
        coalesce(s.recorded_chargeback, CASE WHEN s.charged_at IS NOT NULL
          THEN greatest(0, s.amount - s.before_chargeback) ELSE null END) AS amount,
        s.outstanding, s.charged_reason AS reason,
        coalesce(s.chargeback_resolution_status,
          CASE WHEN s.outstanding > 0 THEN 'open' WHEN s.written_off > 0 THEN 'written_off' ELSE 'collected' END) AS status,
        'Chargeback' AS kind,
        CASE WHEN s.recorded_chargeback IS NOT NULL THEN 'Recorded chargeback amount'
          WHEN s.charged_at IS NOT NULL THEN 'Reconstructed from payments at chargeback date'
          ELSE 'Chargeback amount not recorded; no verifiable date' END AS amount_source
      FROM balances s WHERE s.chargeback_status = 'charged'
      UNION ALL
      SELECT 'short-pay/' || s.id::text, 'shortPays', s.id, coalesce(x.resolution_date,s.last_payment, s.funded_at),
        s.amount, s.cash, coalesce(x.original_short_pay,s.amount - s.cash), s.outstanding,
        CASE WHEN s.cash = 0 THEN 'No cash applied' ELSE 'Cash applied is less than invoice amount' END,
        CASE WHEN s.outstanding>0 THEN 'open' WHEN coalesce(x.written_off,0)>0 THEN 'written_off' ELSE 'resolved' END,
        'Short pay', 'All applied cash'
      FROM balances s LEFT JOIN resolutions x ON x.invoice_id=s.id
      WHERE s.funded_at IS NOT NULL AND (x.invoice_id IS NOT NULL OR (s.status NOT IN ('paid','settled','rejected')
        AND s.cash < s.amount AND s.outstanding > 0
        AND coalesce((SELECT x.status FROM exceptions x WHERE x.type = 'short_pay'
          AND x.entity_type = 'invoice' AND x.entity_id = s.id
          ORDER BY coalesce(x.updated_at,x.created_at) DESC, x.id DESC LIMIT 1),'open') NOT IN ('resolved','waived')))
      UNION ALL
      SELECT 'payout/' || p.id::text || '/' || v.kind, 'deductions', s.id, v.date,
        0::numeric, 0::numeric, v.amount, 0::numeric, v.reason, 'applied', v.kind, 'Applied payout'
      FROM payouts p JOIN balances s ON s.id = p.invoice_id
      CROSS JOIN LATERAL (VALUES
        ('Factoring fee', coalesce(p.advance_paid_at,s.funded_at), p.fee_amount, 'Factoring fee deducted at funding'),
        ('Reserve withheld', coalesce(p.advance_paid_at,s.funded_at), p.reserve_amount, 'Reserve withheld at funding'),
        ('Reserve released', p.reserve_released_at, -p.reserve_amount, 'Reserve released (credit)')
      ) v(kind,date,amount,reason)
      WHERE s.funded_at IS NOT NULL AND v.amount <> 0
        AND (p.advance_paid_at IS NOT NULL OR p.payment_status IN ('advance_paid','reserve_pending','reserve_released','complete'))
        AND (v.kind <> 'Reserve released' OR p.reserve_released_at IS NOT NULL OR p.payment_status IN ('reserve_released','complete'))
      UNION ALL
      SELECT 'adjustment/' || l.id::text, 'deductions', s.id, l.created_at,
        0::numeric, 0::numeric, CASE WHEN l.payload_json->>'amount' ~ '^-?[0-9]+([.][0-9]{1,2})?$'
          THEN (l.payload_json->>'amount')::numeric * CASE WHEN l.event_type='chargeback_refunded' THEN -1 ELSE 1 END END, 0::numeric,
        coalesce(nullif(l.payload_json->>'reason',''), nullif(l.payload_json->>'description',''), replace(l.event_type,'_',' ')),
        'applied', CASE WHEN l.event_type='chargeback_refunded' THEN 'Reserve refund credit' ELSE replace(l.event_type,'_',' ') END, 'Recorded invoice ledger adjustment'
      FROM event_ledger l JOIN balances s ON l.entity_type = 'invoice' AND s.id = l.entity_id
      WHERE l.event_type IN ('fee_adjustment','reserve_adjustment','offset_applied','deduction_applied','chargeback_refunded')
        AND l.payload_json->>'amount' ~ '^-?[0-9]+([.][0-9]{1,2})?$'
        AND CASE WHEN l.payload_json->>'amount' ~ '^-?[0-9]+([.][0-9]{1,2})?$'
          THEN (l.payload_json->>'amount')::numeric ELSE 0 END <> 0
    ), enriched AS (
      SELECT r.*, s.invoice_number, s.client_id AS carrier_id, s.carrier_name,s.broker_id,s.broker_name,
        coalesce(f.refunded,0) AS refunded,f.refund_date,
        CASE WHEN r.section='chargebacks' THEN f.reference ELSE x.reference END AS payment_reference,
        coalesce(x.recovered,0) AS recovered,
        coalesce(x.original_short_pay,CASE WHEN r.section='shortPays' THEN r.amount ELSE 0 END) AS original_short_pay,
        CASE WHEN r.section='chargebacks' AND r.amount IS NOT NULL THEN greatest(0,r.amount-coalesce(f.refunded,0)) ELSE null END AS net_chargeback,
        CASE WHEN r.section='chargebacks' THEN greatest(0,r.outstanding-coalesce(f.refunded,0)) ELSE r.outstanding END AS net_outstanding,
        CASE WHEN r.section='chargebacks' THEN least(greatest(0,r.amount-coalesce(f.refunded,0)),greatest(0,b.cash-b.before_chargeback)) ELSE 0 END AS collected_amount,
        CASE WHEN r.section='chargebacks' THEN least(b.written_off,greatest(0,r.amount-coalesce(f.refunded,0))) ELSE coalesce(x.written_off,0) END AS written_off_amount,
        CASE WHEN lower(r.kind) LIKE '%fee%' THEN 'fee_adjustment'
          WHEN lower(r.kind) LIKE '%reserve%' THEN 'reserve_movement'
          WHEN lower(r.kind) LIKE '%offset%' THEN 'offset' ELSE r.kind END AS deduction_type,
        CASE WHEN r.section='chargebacks' AND r.amount IS NOT NULL AND coalesce(f.refunded,0)>=r.amount AND f.refunded>0
          THEN 'refunded' WHEN r.section='chargebacks' AND f.refunded>0 AND r.status<>'written_off'
          THEN 'open' ELSE r.status END AS effective_status,
        CASE WHEN r.date IS NOT NULL THEN to_char(r.date,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS iso_date
      FROM entries r JOIN scoped s ON s.id=r.invoice_id JOIN balances b ON b.id=r.invoice_id
      LEFT JOIN refunds f ON f.invoice_id=r.invoice_id LEFT JOIN resolutions x ON x.invoice_id=r.invoice_id
    )
    SELECT r.* FROM enriched r
    WHERE true
      ${filters.startDate ? sql`AND (r.date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date >= ${filters.startDate}::date` : sql``}
      ${filters.endDate ? sql`AND (r.date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date <= ${filters.endDate}::date` : sql``}
      ${filters.status !== "all" ? sql`AND r.effective_status = ${filters.status}` : sql``}
      ${filters.section ? sql`AND r.section = ${filters.section}` : sql``}
      ${filters.deductionType !== "all" ? sql`AND (r.section <> 'deductions' OR r.deduction_type=${filters.deductionType})` : sql``}
      ${filters.minAmount !== undefined ? sql`AND abs(r.amount) >= ${filters.minAmount}` : sql``}
      ${filters.maxAmount !== undefined ? sql`AND abs(r.amount) <= ${filters.maxAmount}` : sql``}
    ORDER BY r.date DESC NULLS LAST, r.section, r.id
  `);
  const report: ChargebackReport = {
    chargebacks: [], shortPays: [], deductions: [],
    totals: { chargebacks: emptyTotals(), shortPays: emptyTotals(), deductions: emptyTotals() },
    notices: [
      "Dates use America/Denver: chargeback event date, latest cash application (or funded date for unpaid invoices), and deduction event date.",
      "Short Pays includes unpaid and partially paid funded invoices plus tracked resolutions. Historical resolved/waived exceptions without resolution snapshots remain excluded; differences use all applied cash.",
      "Positive deductions are withheld/charged; negative deductions are releases/credits. Only applied payouts and explicitly recorded invoice ledger adjustments are included, not pending fees or payroll deductions.",
      "Chargeback and Short Pays can contain the same invoice. Their totals are separate and must not be added together.",
    ],
  };
  for (const raw of result.rows as Record<string, unknown>[]) {
    const section = String(raw.section) as ChargebackReportSection;
    if (!sections.includes(section)) throw new Error("Invalid report section.");
    const row: ChargebackReportRow = {
      id: String(raw.id), section, date: raw.iso_date == null ? null : String(raw.iso_date),
      invoiceId: Number(raw.invoice_id), invoiceNumber: String(raw.invoice_number),
      carrierId: Number(raw.carrier_id), carrierName: String(raw.carrier_name),
      brokerId: raw.broker_id == null ? null : Number(raw.broker_id), brokerName: String(raw.broker_name),
      originalAmount: cents(raw.original_amount) / 100, cashApplied: cents(raw.cash_applied) / 100,
      amount: raw.amount == null ? null : cents(raw.amount) / 100, outstanding: cents(raw.net_outstanding) / 100,
      reason: String(raw.reason), status: String(raw.effective_status) as ChargebackReportRow["status"],
      kind: String(raw.kind), amountSource: String(raw.amount_source),
      refundDate: raw.refund_date ? new Date(String(raw.refund_date)).toISOString() : null,
      refundedAmount: section === "chargebacks" ? cents(raw.refunded) / 100 : 0,
      netChargeback: raw.net_chargeback == null ? null : cents(raw.net_chargeback) / 100,
      paymentReference: raw.payment_reference == null ? null : String(raw.payment_reference),
      recoveredAmount: section === "shortPays" ? cents(raw.recovered) / 100 : 0,
      originalShortPay: section === "shortPays" ? cents(raw.original_short_pay) / 100 : 0,
      collectedAmount: section === "chargebacks" ? cents(raw.collected_amount) / 100 : 0,
      writtenOffAmount: section === "deductions" ? 0 : cents(raw.written_off_amount) / 100,
    };
    report[section].push(row);
    const total = report.totals[section];
    total.count++;
    for (const field of ["originalAmount", "cashApplied", "outstanding"] as const) total[field] = sumMoney(total[field], row[field]);
    if (row.amount == null) total.unknownAmounts++; else total.amount = sumMoney(total.amount, row.amount);
    total.refunded = sumMoney(total.refunded, row.refundedAmount);
    total.collected = sumMoney(total.collected, row.collectedAmount);
    total.writtenOff = sumMoney(total.writtenOff, row.writtenOffAmount);
    total.recovered = sumMoney(total.recovered, row.recoveredAmount);
    total.netOutstanding = sumMoney(total.netOutstanding, row.outstanding);
    if (section === "deductions") total.byType[String(raw.deduction_type)] = sumMoney(total.byType[String(raw.deduction_type)] || 0, row.amount || 0);
  }
  if (report.totals.chargebacks.unknownAmounts) report.notices.push("Unknown chargeback amounts are blank and excluded from amount totals. Date/amount filters exclude entries whose date/amount is unknown.");
  return report;
}

const csvCell = (value: unknown) => {
  if (typeof value === "number") return `"${value.toFixed(2)}"`;
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export const chargebackCsvColumns: Record<string, string> = {
  date: "Date", invoiceNumber: "Invoice", carrierName: "Carrier", brokerName: "Broker",
  originalAmount: "Original amount", cashApplied: "Cash applied", amount: "Amount", outstanding: "Outstanding",
  reason: "Reason", status: "Status", kind: "Type", amountSource: "Amount source",
  refundDate: "Refund date", refundedAmount: "Refund amount", netChargeback: "Net chargeback",
  paymentReference: "Payment reference", recoveredAmount: "Recovered", originalShortPay: "Original short pay",
  collectedAmount: "Collected", writtenOffAmount: "Written off",
};
export function chargebackReportCsv(report: ChargebackReport, columns?: string[]): string {
  if (columns) {
    if (!columns.length || columns.length > Object.keys(chargebackCsvColumns).length
      || new Set(columns).size !== columns.length || columns.some(key => !chargebackCsvColumns[key]))
      throw new Error("Invalid export columns.");
    const lines: unknown[][] = [columns.map(key => chargebackCsvColumns[key])];
    for (const section of sections) {
      for (const row of report[section]) lines.push(columns.map(key => row[key as keyof ChargebackReportRow]));
      if (report[section].length) {
        const total = report.totals[section];
        const totals: Record<string, unknown> = { invoiceNumber: "TOTAL", originalAmount: total.originalAmount,
          cashApplied: total.cashApplied, amount: total.amount, outstanding: total.outstanding, refundedAmount: total.refunded,
          collectedAmount: total.collected, writtenOffAmount: total.writtenOff, recoveredAmount: total.recovered,
          originalShortPay: report[section].reduce((sum, row) => sumMoney(sum, row.originalShortPay), 0),
          netChargeback: report[section].reduce((sum, row) => sumMoney(sum, row.netChargeback || 0), 0) };
        lines.push(columns.map(key => totals[key] ?? ""));
      }
    }
    return "\uFEFF" + lines.map(line => line.map(csvCell).join(",")).join("\r\n");
  }
  const headers = ["Company", "Section", "Date", "Invoice", "Carrier", "Broker", "Original amount", "Cash applied", "Amount", "Outstanding", "Reason", "Status", "Type", "Amount source"];
  const lines: unknown[][] = [headers];
  for (const section of sections) {
    for (const row of report[section]) lines.push([
      "Trucking Pros Financial", section, row.date ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.date)) : "",
      row.invoiceNumber, row.carrierName, row.brokerName,
      row.originalAmount, row.cashApplied, row.amount ?? "", row.outstanding,
      row.reason, row.status, row.kind, row.amountSource,
    ]);
    const total = report.totals[section];
    lines.push(["Trucking Pros Financial", section, "", "TOTAL", "", "", total.originalAmount,
      total.cashApplied, total.amount, total.outstanding,
      `${total.count} entries${total.unknownAmounts ? `; ${total.unknownAmounts} unknown amounts excluded` : ""}`, "", "", ""]);
  }
  return "\uFEFF" + lines.map(line => line.map(csvCell).join(",")).join("\r\n");
}

export async function searchChargebackReportDirectory(input: unknown, store: Store = db) {
  const filter = z.object({
    kind: z.enum(["carrier", "broker"]), q: z.string().trim().max(120).optional().default(""),
    limit: z.coerce.number().int().min(1).max(20).optional().default(8),
  }).strict().parse(input);
  const table = filter.kind === "carrier" ? sql`clients` : sql`brokers`;
  const pattern = `%${filter.q.replace(/[\\%_]/g, "\\$&")}%`;
  const result = await store.execute(sql`SELECT id, name FROM ${table}
    WHERE name ILIKE ${pattern} ORDER BY name, id LIMIT ${filter.limit}`);
  return { data: (result.rows as { id: number; name: string }[]).map(row => ({ id: row.id, name: row.name })) };
}
