import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../db";
import { getInvoiceOcrAlerts } from "./invoiceOcrAlerts";
import {
  brokerAuthorityAlerts,
  brokerAuthorityChecks,
  brokers,
  carrierAlerts,
  carrierAuthorityChecks,
  clients,
  invoicePreflightSettings,
  invoices,
  loads,
} from "../../shared/schema";

export type InvoicePreflightAlert = {
  code: string;
  severity: "block" | "ack" | "info";
  title: string;
  message: string;
  link?: string;
};

export type InvoicePreflightInput = {
  carrierId: number;
  brokerId?: number | null;
  invoiceNumber?: string | null;
  loadNumber?: string | null;
  amount?: number | string | null;
  serviceDate?: string | null;
  excludeInvoiceId?: number | null;
};

export type InvoicePreflightSettings = {
  rules: Record<string, boolean>;
  dormantDays: number;
  nearAmountTolerance: number;
  nearServiceDateDays: number;
};

const DEFAULT_RULES: Record<string, boolean> = {
  DUPLICATE_EXACT: true,
  DUPLICATE_NEAR: true,
  CARRIER_DORMANT: true,
  CARRIER_MANUAL_ALERT: true,
  BROKER_MANUAL_ALERT: true,
  BROKER_GRADE_LOW: true,
  BROKER_CHARGEBACKS: true,
  BROKER_UNCONFIRMED: true,
  AUTHORITY_INACTIVE: true,
  DOCS_EXPIRED: true,
  CARRIER_OPEN_CHARGEBACK: true,
};

const PROCESSED_STATUSES = ["approved", "funded", "settled", "paid"] as const;
const OPEN_CHARGEBACK_STATUSES = ["scheduled", "extended"] as const;

type PreflightDb = typeof db;
type ManualAlert = { id: number; severity: "block" | "ack" | "info"; title: string; message: string };
/** Request-local bulk lookups for dashboard ack/block checks. The dashboard
 * reads OCR failure state separately; ordinary intake still runs every check. */
export type DashboardPreflightContext = {
  settings: InvoicePreflightSettings; now: Date;
  exactMatches: { id: number; carrierInvoiceNumber: string | null; loadNumber: string | null }[];
  carrier: { id: number; name: string } | null; lastProcessed: Date | null;
  manualCarrier: ManualAlert[]; manualBroker: ManualAlert[];
  broker: { id: number; creditGrade: string | null } | null;
  unconfirmed: { id: number; invoiceNumber: string } | null;
  brokerChargeback: { id: number } | null; carrierChargeback: { id: number } | null;
  brokerAuthority: Pick<typeof brokerAuthorityChecks.$inferSelect, "authorityStatus" | "checkStatus" | "allowedToOperate" |
    "operatingStatus" | "commonAuthorityStatus" | "contractAuthorityStatus" | "brokerAuthorityStatus"> | null;
  carrierAuthority: Pick<typeof carrierAuthorityChecks.$inferSelect, "authorityStatus" | "checkStatus"> | null;
  expiredInsuranceAlerts: { id: number; notes: string | null }[];
};

function enabled(settings: InvoicePreflightSettings, code: string): boolean {
  return settings.rules[code] !== false;
}

function validDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function amountNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function withinDays(a: Date, b: Date, days: number): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= days * 24 * 60 * 60 * 1000;
}

function dateLabel(value: Date | null): string {
  return value ? value.toLocaleDateString("en-US", { timeZone: "UTC" }) : "unknown";
}

export async function readSettings(client: PreflightDb): Promise<InvoicePreflightSettings> {
  const [row] = await client.select({
    rules: invoicePreflightSettings.rules, dormantDays: invoicePreflightSettings.dormantDays,
    nearAmountTolerance: invoicePreflightSettings.nearAmountTolerance, nearServiceDateDays: invoicePreflightSettings.nearServiceDateDays,
  }).from(invoicePreflightSettings).limit(1);
  const storedRules = row?.rules ?? {};
  return {
    rules: { ...DEFAULT_RULES, ...storedRules },
    dormantDays: Number.isFinite(row?.dormantDays) && row!.dormantDays > 0
      ? row!.dormantDays
      : 45,
    nearAmountTolerance: row ? Number(row.nearAmountTolerance) : 1,
    nearServiceDateDays: Number.isFinite(row?.nearServiceDateDays) && row!.nearServiceDateDays >= 0
      ? row!.nearServiceDateDays
      : 3,
  };
}

function withoutExcludedInvoice<T extends { id: number }>(
  rows: T[],
  excludeInvoiceId?: number | null,
): T[] {
  return excludeInvoiceId ? rows.filter(row => row.id !== excludeInvoiceId) : rows;
}

/**
 * Runs the invoice preflight checks without creating or changing any records.
 * The caller may pass the same Drizzle database client/transaction used by its
 * request; omitting it uses the application database.
 */
export async function runInvoicePreflight(
  input: InvoicePreflightInput,
  dbClient: PreflightDb = db,
  context?: DashboardPreflightContext,
): Promise<{ alerts: InvoicePreflightAlert[] }> {
  const settings = context?.settings ?? await readSettings(dbClient);
  const alerts: InvoicePreflightAlert[] = [];
  if (input.excludeInvoiceId && !context) {
    alerts.push(...await getInvoiceOcrAlerts(input.excludeInvoiceId, dbClient));
  }
  const now = context?.now ?? new Date();
  const excludeWhere = input.excludeInvoiceId
    ? ne(invoices.id, input.excludeInvoiceId)
    : undefined;

  const exactMatches = context ? context.exactMatches : input.invoiceNumber || input.loadNumber
    ? await dbClient.select({
      id: invoices.id,
      carrierInvoiceNumber: invoices.carrierInvoiceNumber,
      loadNumber: invoices.loadNumber,
    }).from(invoices).where(and(
      eq(invoices.clientId, input.carrierId),
      or(
        input.invoiceNumber ? eq(invoices.carrierInvoiceNumber, input.invoiceNumber) : undefined,
        input.loadNumber ? eq(invoices.loadNumber, input.loadNumber) : undefined,
      ),
      excludeWhere,
    ))
    : [];

  if (enabled(settings, "DUPLICATE_EXACT")) {
    for (const match of exactMatches) {
      const matchedOn = [
        input.invoiceNumber && match.carrierInvoiceNumber === input.invoiceNumber
          ? `carrier invoice number ${match.carrierInvoiceNumber}`
          : null,
        input.loadNumber && match.loadNumber === input.loadNumber ? `load ${match.loadNumber}` : null,
      ].filter(Boolean).join(" and ");
      alerts.push({
        code: "DUPLICATE_EXACT",
        severity: "block",
        title: "Possible duplicate invoice",
        message: `Invoice ${match.id} already uses ${matchedOn || "the supplied carrier invoice or load number"}.`,
        link: `/invoices/${match.id}`,
      });
    }
  }

  const inputAmount = amountNumber(input.amount);
  const inputServiceDate = validDate(input.serviceDate);
  if (enabled(settings, "DUPLICATE_NEAR") &&
      input.brokerId != null &&
      inputAmount !== null &&
      inputServiceDate) {
    const candidates = await dbClient.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      amount: invoices.amount,
      // Legacy invoices often have no linked load; invoiceDate is the best
      // available fallback, but is only a proxy for the actual service date.
      serviceDate: sql<Date | null>`coalesce(${loads.deliveryDate}, ${invoices.invoiceDate})`,
    }).from(invoices)
      .leftJoin(loads, eq(invoices.loadId, loads.id))
      .where(and(
        eq(invoices.clientId, input.carrierId),
        eq(invoices.brokerId, input.brokerId),
        excludeWhere,
      ));
    const nearMatches = withoutExcludedInvoice(candidates, input.excludeInvoiceId).filter(candidate => {
      const candidateAmount = amountNumber(candidate.amount);
      const candidateDate = validDate(candidate.serviceDate);
      return candidateAmount !== null &&
        Math.abs(candidateAmount - inputAmount) <= settings.nearAmountTolerance &&
        candidateDate !== null &&
        withinDays(candidateDate, inputServiceDate, settings.nearServiceDateDays);
    });
    for (const match of nearMatches) {
      alerts.push({
        code: "DUPLICATE_NEAR",
        severity: "block",
        title: "Possible near-duplicate invoice",
        message: `Invoice ${match.invoiceNumber} (${match.id}) has the same carrier and broker with a similar amount and service date.`,
        link: `/invoices/${match.id}`,
      });
    }
  }

  const [carrier] = context ? [context.carrier] : await dbClient.select({
    id: clients.id,
    name: clients.name,
  }).from(clients).where(eq(clients.id, input.carrierId)).limit(1);
  if (!carrier) throw new Error(`Carrier ${input.carrierId} was not found.`);

  if (enabled(settings, "CARRIER_DORMANT")) {
    const processed = context ? [] : await dbClient.select({
      invoiceId: invoices.id,
      submittedAt: invoices.submittedAt,
      approvedAt: invoices.approvedAt,
      fundedAt: invoices.fundedAt,
      createdAt: invoices.createdAt,
    }).from(invoices).where(and(
      eq(invoices.clientId, input.carrierId),
      inArray(invoices.status, [...PROCESSED_STATUSES]),
    ));
    const lastProcessed = context ? context.lastProcessed : processed
      .map(row => validDate(row.approvedAt) ?? validDate(row.fundedAt) ??
        validDate(row.submittedAt) ?? validDate(row.createdAt))
      .filter((date): date is Date => date !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const dormantFor = lastProcessed ? now.getTime() - lastProcessed.getTime() : Infinity;
    if (!lastProcessed || dormantFor > settings.dormantDays * 24 * 60 * 60 * 1000) {
      alerts.push({
        code: "CARRIER_DORMANT",
        severity: "ack",
        title: "Carrier has no recent processed invoices",
        message: lastProcessed
          ? `Last processed invoice: ${dateLabel(lastProcessed)}. This is more than ${settings.dormantDays} days ago.`
          : "No processed invoice history was found for this carrier.",
        link: `/clients/${carrier.id}/credit-report`,
      });
    }
  }

  const manualAlertQueries: Array<{
    code: "CARRIER_MANUAL_ALERT" | "BROKER_MANUAL_ALERT";
    query: Promise<Array<{
    id: number;
    severity: "block" | "ack" | "info";
    title: string;
    message: string;
    }>>;
  }> = [];
  if (enabled(settings, "CARRIER_MANUAL_ALERT")) {
    manualAlertQueries.push({
      code: "CARRIER_MANUAL_ALERT",
      query: context ? Promise.resolve(context.manualCarrier) : dbClient.select({
        id: carrierAlerts.id,
        severity: carrierAlerts.severity,
        title: carrierAlerts.title,
        message: carrierAlerts.message,
      }).from(carrierAlerts).where(and(
        eq(carrierAlerts.entityType, "carrier"),
        eq(carrierAlerts.entityId, input.carrierId),
        eq(carrierAlerts.active, true),
        or(isNull(carrierAlerts.expiresAt), gt(carrierAlerts.expiresAt, now)),
      )),
    });
  }
  if (enabled(settings, "BROKER_MANUAL_ALERT") && input.brokerId != null) {
    manualAlertQueries.push({
      code: "BROKER_MANUAL_ALERT",
      query: context ? Promise.resolve(context.manualBroker) : dbClient.select({
        id: carrierAlerts.id,
        severity: carrierAlerts.severity,
        title: carrierAlerts.title,
        message: carrierAlerts.message,
      }).from(carrierAlerts).where(and(
        eq(carrierAlerts.entityType, "broker"),
        eq(carrierAlerts.entityId, input.brokerId),
        eq(carrierAlerts.active, true),
        or(isNull(carrierAlerts.expiresAt), gt(carrierAlerts.expiresAt, now)),
      )),
    });
  }
  const manualAlertGroups = await Promise.all(
    manualAlertQueries.map(async item => ({ code: item.code, alerts: await item.query })),
  );
  for (const { code, alerts: group } of manualAlertGroups) {
    for (const alert of group) {
      alerts.push({
        // Use the row identity so each manual alert can be acknowledged
        // independently; settings continue to toggle the base rule code.
        code: `${code}:${alert.id}`,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
      });
    }
  }

  if (input.brokerId != null) {
    const [broker] = context ? [context.broker] : await dbClient.select({
      id: brokers.id,
      creditGrade: brokers.creditGrade,
    }).from(brokers).where(eq(brokers.id, input.brokerId)).limit(1);
    if (!broker) throw new Error(`Broker ${input.brokerId} was not found.`);

    if (enabled(settings, "BROKER_UNCONFIRMED")) {
      const [unconfirmed] = context ? [context.unconfirmed] : await dbClient.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices).where(and(
          eq(invoices.brokerId, input.brokerId),
          inArray(invoices.status, ["funded", "held"]),
          inArray(invoices.brokerConfirmationStatus, ["pending", "sent", "disputed"]),
          sql`${invoices.fundedAt} is not null`,
          sql`coalesce(${invoices.confirmationSentAt}, ${invoices.fundedAt}) <= ${new Date(now.getTime() - 14 * 86_400_000)}`,
          excludeWhere,
        )).limit(1);
      if (unconfirmed) alerts.push({
        code: "BROKER_UNCONFIRMED", severity: "info",
        title: "Broker has an unconfirmed funded invoice",
        message: `Receipt of ${unconfirmed.invoiceNumber} has not been confirmed after 14 days. This is a risk indicator; aging still starts at the funded date.`,
        link: `/invoices/${unconfirmed.id}`,
      });
    }

    if (enabled(settings, "BROKER_GRADE_LOW") &&
        (broker.creditGrade === "D" || broker.creditGrade === "F")) {
      alerts.push({
        code: "BROKER_GRADE_LOW",
        severity: "ack",
        title: "Broker credit grade is low",
        message: `Broker credit grade is ${broker.creditGrade}.`,
      });
    }

    if (enabled(settings, "BROKER_CHARGEBACKS")) {
      const [chargeback] = context ? [context.brokerChargeback] : await dbClient.select({ id: invoices.id })
        .from(invoices)
        .where(and(
          eq(invoices.brokerId, input.brokerId),
          inArray(invoices.chargebackStatus, [...OPEN_CHARGEBACK_STATUSES]),
        ))
        .limit(1);
      if (chargeback) {
        alerts.push({
          code: "BROKER_CHARGEBACKS",
          severity: "ack",
          title: "Broker has open chargebacks",
          message: "One or more broker invoices have a scheduled or extended chargeback.",
          link: `/invoices/${chargeback.id}`,
        });
      }
    }

    if (enabled(settings, "AUTHORITY_INACTIVE")) {
      const [authority] = context ? [context.brokerAuthority] : await dbClient.select().from(brokerAuthorityChecks)
        .where(and(
          eq(brokerAuthorityChecks.entityType, "broker"),
          eq(brokerAuthorityChecks.entityId, input.brokerId),
        ))
        .orderBy(desc(brokerAuthorityChecks.checkedAt))
        .limit(1);
      const status = authority?.authorityStatus?.toUpperCase() ?? "UNKNOWN";
      const statusText = [
        authority?.operatingStatus,
        authority?.commonAuthorityStatus,
        authority?.contractAuthorityStatus,
        authority?.brokerAuthorityStatus,
      ].filter(Boolean).join(" ").toLowerCase();
      const inactive = status === "INACTIVE" || status === "NOT_AUTHORIZED" ||
        authority?.allowedToOperate === false ||
        /\b(inactive|not authorized|revoked)\b/.test(statusText);
      if (inactive) {
        alerts.push({
          code: "AUTHORITY_INACTIVE",
          severity: "block",
          title: "Broker authority is inactive",
          message: `The latest MC Check reports broker authority as ${status === "UNKNOWN" ? statusText : status}.`,
        });
      } else if (!authority || status === "UNKNOWN" || authority.checkStatus !== "ok") {
        alerts.push({
          code: "AUTHORITY_INACTIVE",
          severity: "info",
          title: "Broker authority status is unknown",
          message: "No successful MC Check authority status is available for this broker.",
        });
      }
    }

    if (enabled(settings, "DOCS_EXPIRED")) {
      const expiredInsuranceAlerts = context ? context.expiredInsuranceAlerts : await dbClient.select({
        id: brokerAuthorityAlerts.id,
        notes: brokerAuthorityAlerts.notes,
      }).from(brokerAuthorityAlerts).where(and(
        eq(brokerAuthorityAlerts.entityType, "broker"),
        eq(brokerAuthorityAlerts.entityId, input.brokerId),
        eq(brokerAuthorityAlerts.alertType, "insurance_lapsed"),
        isNull(brokerAuthorityAlerts.resolvedAt),
      )).limit(10);
      if (expiredInsuranceAlerts.length) {
        alerts.push({
          code: "DOCS_EXPIRED",
          severity: "ack",
          title: "Broker insurance documentation may be expired",
          message: expiredInsuranceAlerts.map(alert => alert.notes).filter(Boolean).join("; ") ||
            "The latest MC Check reported lapsed broker insurance or bond documentation.",
        });
      }
    }
  }

  if (enabled(settings, "AUTHORITY_INACTIVE")) {
    const [authority] = context ? [context.carrierAuthority] : await dbClient.select().from(carrierAuthorityChecks)
      .where(eq(carrierAuthorityChecks.carrierId, input.carrierId))
      .orderBy(desc(carrierAuthorityChecks.checkedAt))
      .limit(1);
    const status = authority?.authorityStatus?.toUpperCase() ?? "UNKNOWN";
    if (authority?.checkStatus === "ok" &&
        (status === "INACTIVE" || status === "NOT_AUTHORIZED")) {
      alerts.push({
        code: "AUTHORITY_INACTIVE",
        severity: "block",
        title: "Carrier authority is inactive",
        message: `The latest MC Check reports carrier authority as ${status}.`,
      });
    } else if (!authority || authority.checkStatus !== "ok" || status === "UNKNOWN") {
      alerts.push({
        code: "AUTHORITY_INACTIVE",
        severity: "info",
        title: "Carrier authority status is unknown",
        message: "No successful MC Check authority status is available for this carrier.",
      });
    }
  }

  if (enabled(settings, "DOCS_EXPIRED")) {
    alerts.push({
      code: "DOCS_EXPIRED",
      severity: "info",
      title: "Carrier document expiry could not be checked",
      message: "Carrier-level document expiry metadata and a reliable carrier-to-document-requirements mapping are not available, so no missing or expired carrier documents are inferred.",
    });
  }

  if (enabled(settings, "CARRIER_OPEN_CHARGEBACK")) {
    const [chargeback] = context ? [context.carrierChargeback] : await dbClient.select({ id: invoices.id })
      .from(invoices)
      .where(and(
        eq(invoices.clientId, input.carrierId),
        inArray(invoices.chargebackStatus, [...OPEN_CHARGEBACK_STATUSES]),
      ))
      .limit(1);
    if (chargeback) {
      alerts.push({
        code: "CARRIER_OPEN_CHARGEBACK",
        severity: "ack",
        title: "Carrier has an open chargeback",
        message: "One or more carrier invoices have a scheduled or extended chargeback.",
        link: `/invoices/${chargeback.id}`,
      });
    }
  }

  // Carrier document expiry dates are not stored on the available schema, and
  // carrier-level requirements have no reliable mapping to uploaded rows.
  // Skip this check rather than inventing expiry state or false blocks.

  return { alerts };
}

/** Return ack-severity alerts that do not have a matching acknowledged code. */
export function getMissingAlertAcknowledgements(
  alerts: InvoicePreflightAlert[],
  acknowledgedCodes: Iterable<string>,
): InvoicePreflightAlert[] {
  const acknowledged = new Set(acknowledgedCodes);
  return alerts.filter(alert => alert.severity === "ack" && !acknowledged.has(alert.code));
}