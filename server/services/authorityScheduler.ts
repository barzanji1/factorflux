/**
 * Daily FMCSA authority check scheduler.
 * Runs at 06:00 UTC every day (configurable via FMCSA_CRON env var).
 * Also exposes runAllAuthorityChecks() for on-demand admin triggers.
 *
 * Every run is recorded in compliance_integration_runs for audit history.
 * Every check snapshot is append-only — old records are never overwritten.
 */

import cron from "node-cron";
import pLimit from "p-limit";
import crypto from "node:crypto";
import { db } from "../db";
import {
  brokers,
  debtors,
  clients,
  brokerAuthorityChecks,
  brokerAuthorityAlerts,
  carrierAuthorityChecks,
  complianceIntegrationRuns,
} from "../../shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { queryEntity } from "./fmcsa";
import { getConfiguredFmcsaWebKey } from "./fmcsa/settings";

export interface AuthorityCheckSummary {
  runId: number;
  status: "completed" | "failed" | "skipped";
  reason?: string;
  total: number;
  success: number;
  notFound: number;
  apiError: number;
  noKey: number;
  alertsCreated: number;
  errors: string[];
  detail: Array<{
    entityType: "broker" | "debtor" | "carrier";
    entityId: number;
    outcome: "ok" | "error" | "skipped";
    authorityStatus: "ACTIVE" | "INACTIVE" | "NOT_AUTHORIZED" | "UNKNOWN" | null;
    error?: string;
  }>;
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

type AuthorityStatus = "ACTIVE" | "INACTIVE" | "NOT_AUTHORIZED" | "UNKNOWN";

function deriveAuthorityStatus(check: StatusFields): AuthorityStatus {
  const values = [
    check.commonAuthorityStatus,
    check.contractAuthorityStatus,
    check.brokerAuthorityStatus,
    check.operatingStatus,
  ].filter(Boolean).join(" ").toLowerCase();

  if (check.allowedToOperate === false || values.includes("not authorized")) return "NOT_AUTHORIZED";
  if (values.includes("inactive") || values.includes("revoked")) return "INACTIVE";
  if (check.allowedToOperate === true || values.includes("active") || values.includes("authorized")) return "ACTIVE";
  return "UNKNOWN";
}

/** Carrier authority must not be inferred from broker-only authority fields. */
export function deriveCarrierAuthorityStatus(check: StatusFields): AuthorityStatus {
  const classify = (value?: string | null): AuthorityStatus => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return "UNKNOWN";
    if (/\bnot authorized\b|\bnot permitted\b|\brevoked\b/.test(normalized)) return "NOT_AUTHORIZED";
    if (/\binactive\b|\bout of service\b/.test(normalized)) return "INACTIVE";
    if (/\bactive\b|\bauthorized\b/.test(normalized)) return "ACTIVE";
    return "UNKNOWN";
  };

  const operatingStatus = classify(check.operatingStatus);
  const allowedToOperate = check.allowedToOperate === true
    ? "ACTIVE"
    : check.allowedToOperate === false ? "NOT_AUTHORIZED" : "UNKNOWN";

  // These carrier-level indicators take precedence over authority-class fields.
  if (operatingStatus !== "UNKNOWN" && allowedToOperate !== "UNKNOWN") {
    return operatingStatus === allowedToOperate ? operatingStatus : "UNKNOWN";
  }
  if (operatingStatus !== "UNKNOWN") return operatingStatus;
  if (allowedToOperate !== "UNKNOWN") return allowedToOperate;

  const classStatuses = [
    classify(check.commonAuthorityStatus),
    classify(check.contractAuthorityStatus),
  ].filter((status): status is Exclude<AuthorityStatus, "UNKNOWN"> => status !== "UNKNOWN");
  const hasActiveClass = classStatuses.includes("ACTIVE");
  const hasAdverseClass = classStatuses.some(status => status === "INACTIVE" || status === "NOT_AUTHORIZED");
  if (hasActiveClass && hasAdverseClass) return "UNKNOWN";
  if (classStatuses.includes("NOT_AUTHORIZED")) return "NOT_AUTHORIZED";
  if (classStatuses.includes("INACTIVE")) return "INACTIVE";
  if (hasActiveClass) return "ACTIVE";
  return "UNKNOWN";
}

/** Generate a human-readable summary of what changed between two checks. */
function buildChangeSummary(
  prev: StatusFields | null,
  next: StatusFields,
  checkStatus: string,
  prevStatus: string | null,
): string {
  if (!prev) return "First check — no previous data.";
  if (checkStatus === "error") return "FMCSA request error — unable to retrieve current data.";
  if (checkStatus === "skipped") return "FMCSA check skipped.";

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
  signal?: AbortSignal,
  assertLease?: () => Promise<void>,
): Promise<{
  alertsCreated: number;
  checkStatus: "ok" | "error" | "skipped";
  notFound: boolean;
  transportFailure: boolean;
  error?: string;
}> {
  const result = await queryEntity(dotNumber, mcNumber, { signal });
  if (signal?.aborted) throw new DOMException("FMCSA run aborted", "AbortError");
  const prev = await getLastCheck(entityType, entityId);
  if (signal?.aborted) throw new DOMException("FMCSA run aborted", "AbortError");
  const brokerMissing = entityType === "broker" && result.status === "not_found";
  const checkStatus: "ok" | "error" | "skipped" =
    result.status === "api_error" ? "error" :
    result.status === "no_key" ? "skipped" :
    result.status === "not_found" && entityType !== "broker" ? "error" :
    "ok";
  const checkError = brokerMissing
    ? "not in QCMobile carrier dataset"
    : result.errorMessage ?? (result.status === "not_found" ? "not in QCMobile carrier dataset" : null);
  const authorityStatus = result.carrier
    ? deriveAuthorityStatus({
        commonAuthorityStatus: result.carrier.commonAuthorityStatus,
        contractAuthorityStatus: result.carrier.contractAuthorityStatus,
        brokerAuthorityStatus: result.carrier.brokerAuthorityStatus,
        operatingStatus: result.carrier.operatingStatus,
        allowedToOperate: result.carrier.allowedToOperate !== undefined
          ? result.carrier.allowedToOperate === "Y"
          : null,
      })
    : result.status === "no_key" ? null : "UNKNOWN";

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
    checkStatus,
    authorityStatus,
    checkError,
    errorMessage: checkError,
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
    }, checkStatus, prev ? statusSummary(prev) : null),
  };

  if (signal?.aborted) throw new DOMException("FMCSA run aborted", "AbortError");
  await assertLease?.();
  const [newCheck] = await db.insert(brokerAuthorityChecks).values(checkPayload).returning();

  let alertsCreated = 0;
  if (!prev || prev.id === newCheck.id) {
    return {
      alertsCreated,
      checkStatus,
      notFound: result.status === "not_found",
      transportFailure: result.status === "api_error",
      error: checkError ?? undefined,
    };
  }

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
  if (checkStatus === "ok" && authorityStatus !== "UNKNOWN" && isRevoked(newCheck) && !isRevoked(prev)) {
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
  if (result.status === "not_found" && entityType !== "broker" && prev.checkStatus === "ok") {
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
    checkStatus === "ok" &&
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
    if (signal?.aborted) throw new DOMException("FMCSA run aborted", "AbortError");
    await assertLease?.();
    await db.insert(brokerAuthorityAlerts).values(alerts);
    alertsCreated = alerts.length;
  }

  return {
    alertsCreated,
    checkStatus,
    notFound: result.status === "not_found",
    transportFailure: result.status === "api_error",
    error: checkError ?? undefined,
  };
}

async function checkOneCarrier(
  carrierId: number,
  dotNumber: string | null | undefined,
  mcNumber: string | null | undefined,
  triggeredBy: string,
  integrationRunId: number,
  currentLeaseToken: string,
  signal: AbortSignal,
  assertLease: () => Promise<void>,
): Promise<{
  checkStatus: "ok" | "error" | "skipped";
  notFound: boolean;
  transportFailure: boolean;
  authorityStatus: AuthorityStatus;
  error?: string;
}> {
  const result = await queryEntity(dotNumber, mcNumber, { signal });
  if (signal.aborted) throw new DOMException("FMCSA run aborted", "AbortError");

  const checkStatus: "ok" | "error" | "skipped" =
    result.status === "success" ? "ok" :
    result.status === "no_key" ? "skipped" :
    "error";
  const error = result.status === "not_found"
    ? result.errorMessage ?? "not in QCMobile carrier dataset"
    : result.status === "api_error" ? result.errorMessage ?? "FMCSA request failed" :
    result.status === "no_key" ? result.errorMessage ?? "FMCSA_WEBKEY is not configured" :
    undefined;
  const authorityStatus = result.status === "success" && result.carrier
    ? deriveCarrierAuthorityStatus({
        commonAuthorityStatus: result.carrier.commonAuthorityStatus,
        contractAuthorityStatus: result.carrier.contractAuthorityStatus,
        operatingStatus: result.carrier.operatingStatus,
        allowedToOperate: result.carrier.allowedToOperate !== undefined
          ? result.carrier.allowedToOperate === "Y"
          : null,
      })
    : "UNKNOWN";

  if (signal.aborted) throw new DOMException("FMCSA run aborted", "AbortError");
  await db.transaction(async tx => {
    const [ownedRun] = await tx
      .select({ id: complianceIntegrationRuns.id })
      .from(complianceIntegrationRuns)
      .where(and(
        eq(complianceIntegrationRuns.id, integrationRunId),
        eq(complianceIntegrationRuns.status, "running"),
        eq(complianceIntegrationRuns.leaseToken, currentLeaseToken),
      ))
      .for("update")
      .limit(1);
    if (!ownedRun) {
      await assertLease();
      throw new Error("FMCSA run lease was lost");
    }
    await tx.insert(carrierAuthorityChecks).values({
      carrierId,
      mcNumber: mcNumber ?? null,
      dotNumber: dotNumber ?? null,
      authorityStatus,
      operatingStatus: result.carrier?.operatingStatus ?? null,
      checkStatus,
      checkError: error ?? null,
      checkedBy: triggeredBy,
      integrationRunId,
      rawResponse: result.rawResponse ?? null,
    });
  });

  return {
    checkStatus,
    notFound: result.status === "not_found",
    transportFailure: result.status === "api_error",
    authorityStatus,
    error,
  };
}

export async function runAllAuthorityChecks(
  triggeredBy = "system",
): Promise<AuthorityCheckSummary> {
  await db
    .update(complianceIntegrationRuns)
    .set({
      status: "failed",
      completedAt: new Date(),
      reason: "Interrupted before completion",
    })
    .where(and(
      eq(complianceIntegrationRuns.status, "running"),
      sql`${complianceIntegrationRuns.heartbeatAt} < now() - interval '2 minutes'`,
    ));

  // Create the integration run record (status = "running")
  let run: typeof complianceIntegrationRuns.$inferSelect;
  const leaseToken = crypto.randomUUID();
  try {
    [run] = await db
      .insert(complianceIntegrationRuns)
      .values({
        runType: triggeredBy === "system" ? "scheduled" : "manual",
        triggeredBy,
        status: "running",
        heartbeatAt: new Date(),
        leaseToken,
      })
      .returning();
  } catch (error: any) {
    if (error?.code !== "23505") throw error;
    [run] = await db
      .insert(complianceIntegrationRuns)
      .values({
        runType: triggeredBy === "system" ? "scheduled" : "manual",
        triggeredBy,
        status: "skipped",
        completedAt: new Date(),
        reason: "Another FMCSA authority check is already running",
      })
      .returning();
    return {
      runId: run.id,
      status: "skipped",
      reason: "Another FMCSA authority check is already running",
      total: 0,
      success: 0,
      notFound: 0,
      apiError: 0,
      noKey: 0,
      alertsCreated: 0,
      errors: [],
      detail: [],
    };
  }

  const summary: AuthorityCheckSummary = {
    runId: run.id,
    status: "completed",
    total: 0,
    success: 0,
    notFound: 0,
    apiError: 0,
    noKey: 0,
    alertsCreated: 0,
    errors: [],
    detail: [],
  };
  const runAbortController = new AbortController();
  let abortReason: string | null = null;
  const loseLease = (reason: string) => {
    if (abortReason) return;
    abortReason = reason;
    runAbortController.abort();
  };
  const assertLease = async () => {
    const [ownedRun] = await db
      .select({ id: complianceIntegrationRuns.id })
      .from(complianceIntegrationRuns)
      .where(and(
        eq(complianceIntegrationRuns.id, run.id),
        eq(complianceIntegrationRuns.status, "running"),
        eq(complianceIntegrationRuns.leaseToken, leaseToken),
      ))
      .limit(1);
    if (!ownedRun) {
      loseLease("FMCSA run lease was lost");
      throw new Error("FMCSA run lease was lost");
    }
  };
  const heartbeatTimer = setInterval(() => {
    void db
      .update(complianceIntegrationRuns)
      .set({ heartbeatAt: new Date() })
      .where(and(
        eq(complianceIntegrationRuns.id, run.id),
        eq(complianceIntegrationRuns.status, "running"),
        eq(complianceIntegrationRuns.leaseToken, leaseToken),
      ))
      .returning({ id: complianceIntegrationRuns.id })
      .then((rows) => {
        if (rows.length === 0) loseLease("FMCSA run lease was lost");
      })
      .catch((error) => {
        console.error(`[FMCSA] Run #${run.id} heartbeat failed:`, error);
        loseLease("FMCSA run heartbeat failed");
      });
  }, 30_000);

  try {
    const webKey = await getConfiguredFmcsaWebKey();
    if (!webKey) {
      const reason = "FMCSA_WEBKEY not configured";
      summary.status = "skipped";
      summary.reason = reason;
      await db
        .update(complianceIntegrationRuns)
        .set({
          status: "skipped",
          reason,
          completedAt: new Date(),
          detail: [],
        })
        .where(and(
          eq(complianceIntegrationRuns.id, run.id),
          eq(complianceIntegrationRuns.status, "running"),
          eq(complianceIntegrationRuns.leaseToken, leaseToken),
        ));
      console.warn(`[FMCSA] Run #${run.id} skipped — ${reason}`);
      return summary;
    }

    const allBrokers = await db.select().from(brokers).where(and(
      eq(brokers.status, "active"),
      triggeredBy === "system" ? sql`${brokers.dataOrigin} IS DISTINCT FROM ${"pilot"}` : undefined,
    ));
    const allDebtors = await db.select().from(debtors).where(eq(debtors.status, "active"));
    const allCarriers = await db.select().from(clients).where(eq(clients.status, "active"));

    const tasks: Array<{
      entityType: "broker" | "debtor" | "carrier";
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
      ...allCarriers
        .filter(c => c.dotNumber?.trim() || c.mcNumber?.trim())
        .map(c => ({
          entityType: "carrier" as const,
          id: c.id,
          name: c.name,
          dot: c.dotNumber,
          mc: c.mcNumber,
        })),
    ];

    summary.total = tasks.length;

    const limit = pLimit(8);
    let consecutiveFailures = 0;

    await Promise.all(tasks.map(task => limit(async () => {
      if (abortReason) return;
      try {
        let checkStatus: "ok" | "error" | "skipped";
        let notFound: boolean;
        let transportFailure: boolean;
        let error: string | undefined;
        let carrierAuthorityStatus: AuthorityStatus | null = null;
        let alertsCreated = 0;
        if (task.entityType === "carrier") {
          const result = await checkOneCarrier(
            task.id,
            task.dot,
            task.mc,
            triggeredBy,
            run.id,
            leaseToken,
            runAbortController.signal,
            assertLease,
          );
          ({ checkStatus, notFound, transportFailure, error } = result);
          carrierAuthorityStatus = result.authorityStatus;
        } else {
          const result = await checkOneEntity(
            task.entityType,
            task.id,
            task.name,
            task.dot,
            task.mc,
            triggeredBy,
            run.id,
            runAbortController.signal,
            assertLease,
          );
          ({ checkStatus, notFound, transportFailure, error, alertsCreated } = result);
        }
        summary.alertsCreated += alertsCreated;
        const latest = task.entityType === "carrier"
          ? null
          : await getLastCheck(task.entityType, task.id);
        if (notFound) summary.notFound++;
        if (!transportFailure) {
          consecutiveFailures = 0;
        }
        if (checkStatus === "ok") {
          summary.success++;
        } else if (checkStatus === "skipped") {
          summary.noKey++;
        } else {
          summary.apiError++;
          if (transportFailure) consecutiveFailures++;
        }
        if (error && checkStatus === "error") summary.errors.push(`${task.entityType}#${task.id}: ${error}`);
        summary.detail.push({
          entityType: task.entityType,
          entityId: task.id,
          outcome: checkStatus as "ok" | "error" | "skipped",
          authorityStatus: task.entityType === "carrier"
            ? carrierAuthorityStatus
            : latest?.authorityStatus ?? null,
          ...(error ? { error } : {}),
        });
        if (consecutiveFailures >= 20) {
          loseLease("Aborted after 20 consecutive FMCSA request failures");
        }
      } catch (err) {
        if (runAbortController.signal.aborted && abortReason) return;
        const message = err instanceof Error ? err.message : String(err);
        loseLease(`Internal FMCSA run failure: ${message}`);
        summary.apiError++;
        summary.errors.push(`${task.entityType}#${task.id}: ${message}`);
        summary.detail.push({
          entityType: task.entityType,
          entityId: task.id,
          outcome: "error",
          authorityStatus: null,
          error: message,
        });
      }
    })));

    if (abortReason) {
      summary.status = "failed";
      summary.reason = abortReason;
      // Queued/in-flight work cancelled by the breaker was not a failed lookup.
      // Account for it explicitly so the run summary does not hide skipped work.
      const finished = new Set(summary.detail.map(item => `${item.entityType}:${item.entityId}`));
      for (const task of tasks) {
        if (finished.has(`${task.entityType}:${task.id}`)) continue;
        summary.noKey++;
        summary.detail.push({
          entityType: task.entityType, entityId: task.id, outcome: "skipped",
          authorityStatus: null, error: abortReason,
        });
      }
    }

    // Mark run complete (or failed after the consecutive-failure circuit breaker).
    await db
      .update(complianceIntegrationRuns)
      .set({
        status: summary.status,
        reason: summary.reason ?? null,
        completedAt: new Date(),
        totalChecked: summary.detail.length,
        successCount: summary.success,
        activeCount: summary.detail.filter(item => item.outcome === "ok" && item.authorityStatus === "ACTIVE").length,
        failureCount: summary.apiError,
        notFoundCount: summary.notFound,
        noKeyCount: summary.noKey,
        alertsCreated: summary.alertsCreated,
        errorLog: summary.errors.length > 0 ? summary.errors : null,
        detail: summary.detail,
      })
      .where(and(
        eq(complianceIntegrationRuns.id, run.id),
        eq(complianceIntegrationRuns.status, "running"),
        eq(complianceIntegrationRuns.leaseToken, leaseToken),
      ));
  } catch (err) {
    summary.status = "failed";
    // Mark run as failed
    await db
      .update(complianceIntegrationRuns)
      .set({
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
        totalChecked: summary.detail.length,
        successCount: summary.success,
        activeCount: summary.detail.filter(item => item.outcome === "ok" && item.authorityStatus === "ACTIVE").length,
        failureCount: summary.apiError,
        noKeyCount: summary.noKey,
        notFoundCount: summary.notFound,
        alertsCreated: summary.alertsCreated,
        errorLog: [err instanceof Error ? err.message : String(err)],
        detail: summary.detail,
      })
      .where(and(
        eq(complianceIntegrationRuns.id, run.id),
        eq(complianceIntegrationRuns.status, "running"),
        eq(complianceIntegrationRuns.leaseToken, leaseToken),
      ));
    throw err;
  } finally {
    clearInterval(heartbeatTimer);
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
