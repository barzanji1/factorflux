/**
 * Daily FMCSA authority check scheduler.
 * Runs at 06:00 UTC every day (configurable via FMCSA_CRON env var).
 * Also exposes runAllAuthorityChecks() for on-demand admin triggers.
 *
 * Every run is recorded in compliance_integration_runs for audit history.
 * Every check snapshot is append-only — old records are never overwritten.
 */

import cron from "node-cron";
import { db } from "../db";
import {
  brokers,
  debtors,
  brokerAuthorityChecks,
  brokerAuthorityAlerts,
  complianceIntegrationRuns,
} from "../../shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { queryEntity } from "./fmcsa";

export interface AuthorityCheckSummary {
  runId: number;
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
  bipdInsuranceOnFile?: string | null;
  brokerBondStatus?: string | null;
};

function isRevoked(check: StatusFields): boolean {
  const bad = ["inactive", "not authorized", "revoked", "n"];
  return [
    check.commonAuthorityStatus,
    check.contractAuthorityStatus,
    check.brokerAuthorityStatus,
    check.allowedToOperate === false ? "n" : undefined,
  ].some(f => f && bad.includes(f.toLowerCase()));
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

/** Generate a human-readable summary of what changed between two checks. */
function buildChangeSummary(
  prev: StatusFields | null,
  next: StatusFields,
  checkStatus: string,
  prevStatus: string | null,
): string {
  if (!prev) return "First check — no previous data.";
  if (checkStatus === "not_found") return "Record no longer found in FMCSA SAFER.";
  if (checkStatus === "api_error") return "API error — unable to retrieve data.";
  if (checkStatus === "no_key") return "FMCSA web key not configured.";

  const changes: string[] = [];

  const compareFields: Array<{ key: keyof StatusFields; label: string }> = [
    { key: "commonAuthorityStatus", label: "Common Authority" },
    { key: "contractAuthorityStatus", label: "Contract Authority" },
    { key: "brokerAuthorityStatus", label: "Broker Authority" },
    { key: "operatingStatus", label: "Operating Status" },
    { key: "bipdInsuranceOnFile", label: "BIPD Insurance on File" },
    { key: "brokerBondStatus", label: "Broker Bond Status" },
  ];

  for (const { key, label } of compareFields) {
    const prevVal = prev[key];
    const nextVal = next[key];
    if (prevVal && nextVal && prevVal !== nextVal) {
      changes.push(`${label}: ${prevVal} → ${nextVal}`);
    }
  }

  if (prev.allowedToOperate !== next.allowedToOperate) {
    changes.push(
      `Allowed to Operate: ${prev.allowedToOperate ? "Yes" : "No"} → ${next.allowedToOperate ? "Yes" : "No"}`,
    );
  }

  if (changes.length === 0) return "No changes detected.";
  return changes.join("; ");
}

async function getLastCheck(entityType: "broker" | "debtor", entityId: number) {
  const [row] = await db
    .select()
    .from(brokerAuthorityChecks)
    .where(
      and(
        eq(brokerAuthorityChecks.entityType, entityType),
        eq(brokerAuthorityChecks.entityId, entityId),
      ),
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
  triggeredBy = "system",
  integrationRunId?: number,
): Promise<{ alertsCreated: number; checkStatus: string; error?: string }> {
  const result = await queryEntity(dotNumber, mcNumber);
  const prev = await getLastCheck(entityType, entityId);

  const checkPayload: typeof brokerAuthorityChecks.$inferInsert = {
    entityType,
    entityId,
    entityName,
    // Typed FKs
    brokerId: entityType === "broker" ? entityId : null,
    debtorId: entityType === "debtor" ? entityId : null,
    integrationRunId: integrationRunId ?? null,
    // Identifiers
    mcNumber: mcNumber ?? null,
    dotNumber: dotNumber ?? null,
    // Check outcome
    checkStatus: result.status,
    errorMessage: result.errorMessage ?? null,
    rawResponse: result.rawResponse ?? null,
    checkedBy: triggeredBy,
    // FMCSA identity
    legalName: result.carrier?.legalName ?? null,
    dbaName: result.carrier?.dbaName ?? null,
    // Authority
    operatingStatus: result.carrier?.operatingStatus ?? null,
    commonAuthorityStatus: result.carrier?.commonAuthorityStatus ?? null,
    contractAuthorityStatus: result.carrier?.contractAuthorityStatus ?? null,
    brokerAuthorityStatus: result.carrier?.brokerAuthorityStatus ?? null,
    allowedToOperate:
      result.carrier?.allowedToOperate !== undefined
        ? result.carrier.allowedToOperate === "Y"
        : null,
    carrierOperation: result.carrier?.carrierOperation ?? null,
    // Insurance / bond
    bipdRequired: result.carrier?.bipdRequired ?? null,
    bipdInsuranceOnFile: result.carrier?.bipdInsuranceOnFile ?? null,
    cargoInsuranceRequired: result.carrier?.cargoInsuranceRequired ?? null,
    cargoInsuranceOnFile: result.carrier?.cargoInsuranceOnFile ?? null,
    brokerBondStatus: result.carrier?.brokerBondStatus ?? null,
    bondAmount: result.carrier?.bondAmount ?? null,
    // Change summary
    changeSummary: buildChangeSummary(prev, {
      commonAuthorityStatus: result.carrier?.commonAuthorityStatus,
      contractAuthorityStatus: result.carrier?.contractAuthorityStatus,
      brokerAuthorityStatus: result.carrier?.brokerAuthorityStatus,
      operatingStatus: result.carrier?.operatingStatus,
      allowedToOperate: result.carrier?.allowedToOperate !== undefined
        ? result.carrier.allowedToOperate === "Y"
        : null,
      bipdInsuranceOnFile: result.carrier?.bipdInsuranceOnFile,
      brokerBondStatus: result.carrier?.brokerBondStatus,
    }, result.status, prev ? statusSummary(prev) : null),
  };

  const [newCheck] = await db.insert(brokerAuthorityChecks).values(checkPayload).returning();

  let alertsCreated = 0;
  if (!prev || prev.id === newCheck.id) return { alertsCreated, checkStatus: result.status };

  const alerts: (typeof brokerAuthorityAlerts.$inferInsert)[] = [];
  const base = {
    entityType,
    entityId,
    entityName,
    brokerId: entityType === "broker" ? entityId : null,
    debtorId: entityType === "debtor" ? entityId : null,
    mcNumber: mcNumber ?? null,
    dotNumber: dotNumber ?? null,
    checkId: newCheck.id,
  };

  // Authority became inactive / revoked
  if (result.status === "success" && isRevoked(newCheck) && !isRevoked(prev)) {
    alerts.push({
      ...base,
      alertType: "became_inactive",
      severity: "critical",
      previousStatus: statusSummary(prev),
      newStatus: statusSummary(newCheck),
      field: "authority_status",
    });
  }

  // Record disappeared
  if (result.status === "not_found" && prev.checkStatus === "success") {
    alerts.push({
      ...base,
      alertType: "not_found",
      severity: "high",
      previousStatus: statusSummary(prev),
      newStatus: "NOT FOUND",
      field: "record",
    });
  }

  // Insurance lapsed
  if (
    result.status === "success" &&
    prev.bipdInsuranceOnFile === "Y" &&
    newCheck.bipdInsuranceOnFile === "N"
  ) {
    alerts.push({
      ...base,
      alertType: "insurance_lapsed",
      severity: "high",
      previousStatus: "BIPD On File",
      newStatus: "BIPD NOT On File",
      field: "BIPD Insurance",
    });
  }

  // Any status field changed
  const compareFields: Array<{ key: keyof StatusFields; label: string }> = [
    { key: "commonAuthorityStatus", label: "Common Authority" },
    { key: "contractAuthorityStatus", label: "Contract Authority" },
    { key: "brokerAuthorityStatus", label: "Broker Authority" },
    { key: "operatingStatus", label: "Operating Status" },
  ];

  for (const { key, label } of compareFields) {
    const prevVal = prev[key as keyof typeof prev];
    const newVal = newCheck[key as keyof typeof newCheck];
    if (prevVal && newVal && prevVal !== newVal) {
      alerts.push({
        ...base,
        alertType: "status_changed",
        severity: "medium",
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

  return { alertsCreated, checkStatus: result.status };
}

export async function runAllAuthorityChecks(
  triggeredBy = "system",
): Promise<AuthorityCheckSummary> {
  // Create the integration run record (status = "running")
  const [run] = await db
    .insert(complianceIntegrationRuns)
    .values({
      runType: triggeredBy === "system" ? "scheduled" : "manual",
      triggeredBy,
      status: "running",
    })
    .returning();

  const summary: AuthorityCheckSummary = {
    runId: run.id,
    total: 0,
    success: 0,
    notFound: 0,
    apiError: 0,
    noKey: 0,
    alertsCreated: 0,
    errors: [],
  };

  try {
    const allBrokers = await db.select().from(brokers);
    const allDebtors = await db.select().from(debtors);

    const tasks: Array<{
      entityType: "broker" | "debtor";
      id: number;
      name: string;
      dot: string | null | undefined;
      mc: string | null | undefined;
    }> = [
      ...allBrokers
        .filter(b => b.dotNumber || b.mcNumber)
        .map(b => ({
          entityType: "broker" as const,
          id: b.id,
          name: b.name,
          dot: b.dotNumber,
          mc: b.mcNumber,
        })),
      ...allDebtors
        .filter(d => d.dotNumber || d.mcNumber)
        .map(d => ({
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
        const { alertsCreated, checkStatus, error } = await checkOneEntity(
          task.entityType,
          task.id,
          task.name,
          task.dot,
          task.mc,
          triggeredBy,
          run.id,
        );
        summary.alertsCreated += alertsCreated;
        if (checkStatus === "success") summary.success++;
        else if (checkStatus === "not_found") summary.notFound++;
        else if (checkStatus === "no_key") summary.noKey++;
        else summary.apiError++;
        if (error) summary.errors.push(`${task.entityType}#${task.id}: ${error}`);
      } catch (err) {
        summary.apiError++;
        summary.errors.push(
          `${task.entityType}#${task.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Mark run as completed
    await db
      .update(complianceIntegrationRuns)
      .set({
        status: "completed",
        completedAt: new Date(),
        totalChecked: summary.total,
        successCount: summary.success,
        failureCount: summary.apiError,
        notFoundCount: summary.notFound,
        noKeyCount: summary.noKey,
        alertsCreated: summary.alertsCreated,
        errorLog: summary.errors.length > 0 ? summary.errors : null,
      })
      .where(eq(complianceIntegrationRuns.id, run.id));
  } catch (err) {
    // Mark run as failed
    await db
      .update(complianceIntegrationRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorLog: [err instanceof Error ? err.message : String(err)],
      })
      .where(eq(complianceIntegrationRuns.id, run.id));
    throw err;
  }

  console.log(`[FMCSA] Run #${run.id} complete — ${JSON.stringify(summary)}`);
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
