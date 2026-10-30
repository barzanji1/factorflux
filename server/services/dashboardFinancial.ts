import { sql } from "drizzle-orm";
import { db } from "../db";
import type { DashboardFinancial, DashboardViewer } from "../../shared/agent-dashboard";
import { dashboardQuery } from "./agentDashboardQueries";

/** Aggregates only: no invoice list, per-invoice preflight, or history fan-out.
 * Cash means actual applied cash, never write-offs or reserve adjustments.
 * Calendar periods use UTC consistently in SQL and the response.
 */
export async function readDashboardFinancial(
  viewer: DashboardViewer, store = db, now = new Date(),
): Promise<DashboardFinancial> {
  const scope = viewer.role === "employee"
    ? sql`coalesce(i.assigned_to,c.assigned_processor,i.submitted_by) = ${viewer.id}` : sql`true`;
  const result = await dashboardQuery("financial", "aggregate-kpis-and-six-months", store.execute<{
    kpis: DashboardFinancial["kpis"]; months: DashboardFinancial["months"];
    actionGrid: DashboardFinancial["actionGrid"];
  }>(sql`
    WITH clock AS (
      SELECT ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC' AS at
    ), scoped AS MATERIALIZED (
      SELECT i.id,i.invoice_number,i.broker_id,i.amount,i.status,i.created_at,i.invoice_date,i.funded_at,i.chargeback_status,i.chargeback_date
      FROM invoices i JOIN clients c ON c.id=i.client_id WHERE ${scope}
    ), cash AS (
      SELECT p.invoice_id,p.applied_amount,p.variance,p.variance_type,a.payment_date
      FROM payment_application_lines p JOIN scoped s ON s.id=p.invoice_id
      JOIN cash_applications a ON a.id=p.cash_application_id
    ), paid AS (
      SELECT invoice_id,sum(applied_amount) AS amount,
        sum(CASE WHEN variance_type='write_off' THEN abs(coalesce(variance,0)) ELSE 0 END) AS written_off
      FROM cash GROUP BY invoice_id
    ), month_series AS (
      SELECT generate_series(date_trunc('month',at)-interval '5 months',
        date_trunc('month',at),interval '1 month') AS month FROM clock
    ), billed AS (
      SELECT date_trunc('month',coalesce(invoice_date,created_at)) AS month,sum(amount) AS amount
      FROM scoped,clock WHERE status NOT IN ('draft','rejected')
        AND coalesce(invoice_date,created_at)>=date_trunc('month',at)-interval '5 months'
        AND coalesce(invoice_date,created_at)<=at GROUP BY 1
    ), collected AS (
      SELECT date_trunc('month',payment_date) AS month,sum(applied_amount) AS amount
      FROM cash,clock WHERE payment_date>=date_trunc('month',at)-interval '5 months'
        AND payment_date<=at GROUP BY 1
    ), open_followups AS (
      SELECT due_date FROM tasks WHERE assigned_to=${viewer.id} AND status<>'completed'
        AND (type IN ('followup','call') OR confirmation_invoice_id IS NOT NULL)
      UNION ALL
      SELECT f.due_date FROM follow_ups f JOIN clients c ON c.id=f.client_id
        WHERE c.assigned_processor=${viewer.id} AND f.status<>'completed'
      UNION ALL
      SELECT coalesce((SELECT min(r.scheduled_send_at) FROM broker_follow_up_reminders r
        WHERE r.follow_up_id=f.id AND r.status IN ('scheduled','sending')),f.created_at)
      FROM broker_follow_ups f JOIN invoices i ON i.id=f.invoice_id
        JOIN clients c ON c.id=i.client_id WHERE f.status<>'acknowledged'
        AND coalesce(i.assigned_followup_agent_id,i.assigned_to,c.assigned_processor,i.submitted_by)=${viewer.id}
    ), followup_count AS (
      SELECT count(*) AS total FROM open_followups
    ), balances AS (
      SELECT s.*, CASE WHEN s.status IN ('paid','settled') THEN 0 ELSE
        greatest(0,s.amount-coalesce(p.amount,0)-coalesce(p.written_off,0)) END AS outstanding
      FROM scoped s LEFT JOIN paid p ON p.invoice_id=s.id
    ), action_summary AS (
      SELECT jsonb_build_object(
        'docsPending',count(*) FILTER(WHERE status='docs_pending'),
        'recentInvoices',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY "createdAt" DESC,id DESC)
          FROM (SELECT id,invoice_number AS "invoiceNumber",created_at AS "createdAt"
            FROM scoped ORDER BY created_at DESC,id DESC LIMIT 3) t),'[]'),
        'readyToFundCount',count(*) FILTER(WHERE status='approved'),
        'readyToFundAmount',coalesce(sum(amount) FILTER(WHERE status='approved'),0),
        'openFollowups',(SELECT total FROM followup_count),
        'overdueFollowups',(SELECT count(*) FROM open_followups WHERE due_date<date_trunc('day',clock.at)),
        'dueTodayFollowups',(SELECT count(*) FROM open_followups
          WHERE due_date>=date_trunc('day',clock.at) AND due_date<date_trunc('day',clock.at)+interval '1 day'),
        'openChargebacks',count(*) FILTER(WHERE chargeback_status='charged' AND outstanding>0),
        'chargebackAmount',coalesce(sum(outstanding) FILTER(WHERE chargeback_status='charged' AND outstanding>0),0),
        'oldestChargebackDays',max(greatest(0,floor(extract(epoch FROM clock.at-chargeback_date)/86400))) FILTER(
          WHERE chargeback_status='charged' AND outstanding>0),
        'aging60Count',count(*) FILTER(WHERE funded_at<=clock.at-interval '60 days'
          AND chargeback_status<>'charged' AND outstanding>0),
        'aging60Amount',coalesce(sum(outstanding) FILTER(WHERE funded_at<=clock.at-interval '60 days'
          AND chargeback_status<>'charged' AND outstanding>0),0),
        'brokerCount',count(DISTINCT broker_id) FILTER(WHERE funded_at<=clock.at-interval '60 days'
          AND chargeback_status<>'charged' AND outstanding>0)
      ) AS value FROM clock LEFT JOIN balances ON true GROUP BY clock.at
    )
    SELECT jsonb_build_object(
      'readyToFund',coalesce(sum(s.amount) FILTER(WHERE s.status='approved'),0),
      'inReview',count(*) FILTER(WHERE s.status='under_review'),
      'openFollowups',(SELECT total FROM followup_count),
      'aging60Plus',count(*) FILTER(WHERE s.funded_at<=clock.at-interval '60 days'
        AND s.status NOT IN ('paid','settled') AND s.chargeback_status<>'charged'
        AND s.amount>coalesce(p.amount,0)),
      'fundedThisWeek',coalesce(sum(s.amount) FILTER(WHERE s.funded_at>=date_trunc('week',clock.at)
        AND s.funded_at<=clock.at),0),
      'pendingActions',count(*) FILTER(WHERE s.status IN ('submitted','docs_pending','under_review','held','approved'))
    ) AS kpis,
      (SELECT jsonb_agg(jsonb_build_object('month',to_char(m.month,'YYYY-MM'),
        'invoiced',coalesce(b.amount,0),'collected',coalesce(c.amount,0)) ORDER BY m.month)
      FROM month_series m LEFT JOIN billed b ON b.month=m.month LEFT JOIN collected c ON c.month=m.month) AS months,
      (SELECT value FROM action_summary) AS "actionGrid"
    FROM clock LEFT JOIN scoped s ON true LEFT JOIN paid p ON p.invoice_id=s.id
    GROUP BY clock.at
  `));
  return { viewer, generatedAt: now.toISOString(), ...result.rows[0] };
}
