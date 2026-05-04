/**
 * Daily FMCSA authority check scheduler.
 * Runs at 06:00 UTC every day (configurable via FMCSA_CRON env var).
 * Also exposes runAllAuthorityChecks() for on-demand admin triggers.
 */

import cron from "node-cron";
import { db } from "../db";
import { brokers, debtors, brokerAuthorityChecks, brokerAuthorityAlerts } from "../../shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { queryEntity } from "./fmcsa";

export interface AuthorityCheckSummary {
  total: number;
  success: number;
  notFound: number;
  apiError: number;
  noKey: number;
  alertsCreated: number;
  errors: string[];
}

type StatusFields = {
  commonAuthorityStatus?: string | null;
  contractAuthorityStatus?: string | null;
  brokerAuthorityStatus?: string | null;
  operatingStatus?: string | null;
  allowedToOperate?: boolean | null;
};

function isRevoked(check: StatusFields): boolean {
  const bad = ["inactive", "not authorized", "revoked", "n"];
  const fields = [
    check.commonAuthorityStatus,
    check.contractAuthorityStatus,
    check.brokerAuthorityStatus,
    check.allowedToOperate === false ? "n" : undefined,
  ];
  return fields.some(f => f && bad.includes(f.toLowerCase()));
}

function statusSummary(check: StatusFields): string {
  return [
    check.commonAuthorityStatus,
    check.brokerAuthorityStatus,
    check.allowedToOperate === false ? "NOT ALLOWED" : undefined,
  ]
    .filter(Boolean)
    .join(" / ") || "UNKNOWN";
}

async function getLastCheck(entityType: "broker" | "debtor", entityId: number) {
  const [row] = await db
    .select()
    .from(brokerAuthorityChecks)
    .where(
      and(
        eq(brokerAuthorityChecks.entityType, entityType),
        eq(brokerAuthorityChecks.entityId, entityId)
      )
    )
    .orderBy(desc(brokerAuthorityChecks.checkedAt))
    .limit(1);
  return row ?? null;
}

async function checkOneEntity(
  entityType: "broker" | "debtor",
  entityId: number,
  entityName: string,
  dotNumber: string | null | undefined,
  mcNumber: string | null | undefined,
  triggeredBy = "system"
): Promise<{ alertsCreated: number; error?: string }> {
  const result = await queryEntity(dotNumber, mcNumber);

  const checkPayload: typeof brokerAuthorityChecks.$inferInsert = {
    entityType,
    entityId,
    entityName,
    mcNumber: mcNumber ?? null,
    dotNumber: dotNumber ?? null,
    checkStatus: result.status,
    errorMessage: result.errorMessage ?? null,
    rawResponse: result.rawResponse ?? null,
    checkedBy: triggeredBy,
    legalName: result.carrier?.legalName ?? null,
    dbaName: result.carrier?.dbaName ?? null,
    operatingStatus: result.carrier?.operatingStatus ?? null,
    commonAuthorityStatus: result.carrier?.commonAuthorityStatus ?? null,
    contractAuthorityStatus: result.carrier?.contractAuthorityStatus ?? null,
    brokerAuthorityStatus: result.carrier?.brokerAuthorityStatus ?? null,
    allowedToOperate:
      result.carrier?.allowedToOperate !== undefined
        ? result.carrier.allowedToOperate === "Y"
        : null,
    carrierOperation: result.carrier?.carrierOperation ?? null,
    bipdRequired: result.carrier?.bipdRequired ?? null,
  };

  const [newCheck] = await db.insert(brokerAuthorityChecks).values(checkPayload).returning();

  let alertsCreated = 0;
  const prev = await getLastCheck(entityType, entityId);

  // If this is the very first check there's nothing to diff
  if (!prev || prev.id === newCheck.id) return { alertsCreated };

  const alerts: (typeof brokerAuthorityAlerts.$inferInsert)[] = [];

  const base = {
    entityType,
    entityId,
    entityName,
    mcNumber: mcNumber ?? null,
    dotNumber: dotNumber ?? null,
    checkId: newCheck.id,
  };

  // Authority became inactive / revoked
  if (result.status === "success" && isRevoked(newCheck) && !isRevoked(prev)) {
    alerts.push({
      ...base,
      alertType: "became_inactive",
      previousStatus: statusSummary(prev),
      newStatus: statusSummary(newCheck),
      field: "authority_status",
    });
  }

  // Not found when we had data before
  if (result.status === "not_found" && prev.checkStatus === "success") {
    alerts.push({
      ...base,
      alertType: "not_found",
      previousStatus: statusSummary(prev),
      newStatus: "NOT FOUND",
      field: "record",
    });
  }

  // Any individual status field changed
  const compareFields: Array<{ key: keyof StatusFields; label: string }> = [
    { key: "commonAuthorityStatus", label: "Common Authority" },
    { key: "contractAuthorityStatus", label: "Contract Authority" },
    { key: "brokerAuthorityStatus", label: "Broker Authority" },
    { key: "operatingStatus", label: "Operating Status" },
  ];

  for (const { key, label } of compareFields) {
    const prevVal = prev[key];
    const newVal = newCheck[key];
    if (prevVal && newVal && prevVal !== newVal) {
      alerts.push({
        ...base,
        alertType: "status_changed",
        previousStatus: String(prevVal),
        newStatus: String(newVal),
        field: label,
      });
    }
  }

  if (alerts.length > 0) {
    await db.insert(brokerAuthorityAlerts).values(alerts);
    alertsCreated = alerts.length;
  }

  return { alertsCreated };
}

export async function runAllAuthorityChecks(triggeredBy = "system"): Promise<AuthorityCheckSummary> {
  const summary: AuthorityCheckSummary = {
    total: 0,
    success: 0,
    notFound: 0,
    apiError: 0,
    noKey: 0,
    alertsCreated: 0,
    errors: [],
  };

  const allBrokers = await db.select().from(brokers);
  const allDebtors = await db.select().from(debtors);

  const tasks: Array<{
    entityType: "broker" | "debtor";
    id: number;
    name: string;
    dot: string | null | undefined;
    mc: string | null | undefined;
  }> = [
    ...allBrokers.filter(b => b.dotNumber || b.mcNumber).map(b => ({
      entityType: "broker" as const,
      id: b.id,
      name: b.name,
      dot: b.dotNumber,
      mc: b.mcNumber,
    })),
    ...allDebtors.filter(d => d.dotNumber || d.mcNumber).map(d => ({
      entityType: "debtor" as const,
      id: d.id,
      name: d.name,
      dot: d.dotNumber,
      mc: d.mcNumber,
    })),
  ];

  summary.total = tasks.length;

  for (const task of tasks) {
    try {
      const { alertsCreated, error } = await checkOneEntity(
        task.entityType,
        task.id,
        task.name,
        task.dot,
        task.mc,
        triggeredBy
      );
      summary.alertsCreated += alertsCreated;
      // Determine outcome by looking at the last inserted check's status
      const [last] = await db
        .select({ checkStatus: brokerAuthorityChecks.checkStatus })
        .from(brokerAuthorityChecks)
        .where(
          and(
            eq(brokerAuthorityChecks.entityType, task.entityType),
            eq(brokerAuthorityChecks.entityId, task.id)
          )
        )
        .orderBy(desc(brokerAuthorityChecks.checkedAt))
        .limit(1);
      const s = last?.checkStatus ?? "api_error";
      if (s === "success") summary.success++;
      else if (s === "not_found") summary.notFound++;
      else if (s === "no_key") summary.noKey++;
      else summary.apiError++;
      if (error) summary.errors.push(`${task.entityType}#${task.id}: ${error}`);
    } catch (err) {
      summary.apiError++;
      summary.errors.push(`${task.entityType}#${task.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[FMCSA] Check complete — ${JSON.stringify(summary)}`);
  return summary;
}

let schedulerStarted = false;

export function startAuthorityScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const cronExpr = process.env.FMCSA_CRON ?? "0 6 * * *"; // 06:00 UTC daily

  if (!cron.validate(cronExpr)) {
    console.warn(`[FMCSA] Invalid cron expression "${cronExpr}", scheduler not started.`);
    return;
  }

  cron.schedule(cronExpr, async () => {
    console.log("[FMCSA] Running scheduled daily authority check…");
    try {
      await runAllAuthorityChecks("system");
    } catch (err) {
      console.error("[FMCSA] Scheduler error:", err);
    }
  });

  console.log(`[FMCSA] Authority scheduler started — cron: ${cronExpr}`);
}
