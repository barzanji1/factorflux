import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  brokerCreditScores, brokers, cashApplications, exceptions, invoices,
  paymentApplicationLines,
} from "@shared/schema";

const DAY = 86_400_000;
const DENVER_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

const points = (days: number) =>
  days <= 30 ? 40 : days <= 45 ? 30 : days <= 60 ? 20 : days <= 90 ? 10 : 0;
const reliabilityPoints = (percent: number) =>
  percent <= 0 ? 30 : percent <= 10 ? 20 : percent <= 25 ? 10 : percent <= 50 ? 5 : 0;
const chargebackPoints = (count: number) => count === 0 ? 20 : count <= 2 ? 15 : count <= 5 ? 8 : 0;
const shortPayPoints = (count: number) => count === 0 ? 10 : count <= 2 ? 7 : count <= 5 ? 3 : 0;
const gradeFor = (score: number) => score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : score >= 30 ? "D" : "F";

type BrokerCreditInvoice = {
  id: number;
  amount: string;
  fundedAt: Date | null;
  dueDate: Date | null;
  chargebackStatus: string;
  chargebackDate: Date | null;
};

type BrokerCreditPaymentLine = {
  invoiceId: number;
  cashApplicationId: number;
  appliedAmount: string;
  variance: string | null;
  varianceType: string;
  paymentDate: Date;
};

type BrokerCreditException = {
  entityId: number | null;
  type: string;
};

function daysBetween(start: Date, end: Date): number {
  const a = denverDateOrdinal(start);
  const b = denverDateOrdinal(end);
  return Math.max(0, Math.floor((b - a) / DAY));
}

function denverDateOrdinal(value: Date): number {
  const parts = Object.fromEntries(
    DENVER_DATE.formatToParts(value)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, Number(part.value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

/**
 * Rebuild one broker's score from immutable payment application events. This
 * deliberately uses only broker-linked invoices and positive outstanding
 * balances; unresolved exceptions are the source of the dispute factor.
 */
export async function recalculateBrokerCredit(brokerId: number) {
  const lockKey = 743_000_000 + brokerId;
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey})`);
    return calculateBrokerCredit(tx, brokerId);
  });
}

async function calculateBrokerCredit(tx: any, brokerId: number) {
  const [broker] = await tx.select({
    id: brokers.id, paymentTerms: brokers.paymentTerms,
  }).from(brokers).where(eq(brokers.id, brokerId)).limit(1);
  if (!broker) throw new Error("Broker not found");

  const rows: BrokerCreditInvoice[] = await tx.select({
    id: invoices.id, amount: invoices.amount, fundedAt: invoices.fundedAt, dueDate: invoices.dueDate,
    chargebackStatus: invoices.chargebackStatus, chargebackDate: invoices.chargebackDate,
  }).from(invoices).where(eq(invoices.brokerId, brokerId));
  const ids = rows.map(r => r.id);
  const lines: BrokerCreditPaymentLine[] = ids.length ? await tx.select({
    invoiceId: paymentApplicationLines.invoiceId,
    cashApplicationId: paymentApplicationLines.cashApplicationId,
    appliedAmount: paymentApplicationLines.appliedAmount,
    variance: paymentApplicationLines.variance,
    varianceType: paymentApplicationLines.varianceType,
    paymentDate: cashApplications.paymentDate,
  }).from(paymentApplicationLines)
    .innerJoin(cashApplications, eq(paymentApplicationLines.cashApplicationId, cashApplications.id))
    .where(inArray(paymentApplicationLines.invoiceId, ids))
    .orderBy(asc(cashApplications.paymentDate), asc(paymentApplicationLines.id)) : [];
  const applicationIds: number[] = Array.from(new Set(lines.map(line => line.cashApplicationId)));
  const openInvoiceExceptions: BrokerCreditException[] = ids.length ? await tx.select({
    entityId: exceptions.entityId, type: exceptions.type,
  }).from(exceptions).where(and(
    eq(exceptions.entityType, "invoice"),
    inArray(exceptions.entityId, ids),
    notInArray(exceptions.status, ["resolved", "waived"] as any[]),
  )) : [];
  const openPaymentExceptions: BrokerCreditException[] = applicationIds.length ? await tx.select({
    entityId: exceptions.entityId, type: exceptions.type,
  }).from(exceptions).where(and(
    eq(exceptions.entityType, "payment"),
    inArray(exceptions.entityId, applicationIds),
    notInArray(exceptions.status, ["resolved", "waived"] as any[]),
  )) : [];
  const openBrokerExceptions: BrokerCreditException[] = await tx.select({
    entityId: exceptions.entityId, type: exceptions.type,
  }).from(exceptions).where(and(
    eq(exceptions.entityType, "broker"),
    eq(exceptions.entityId, brokerId),
    notInArray(exceptions.status, ["resolved", "waived"] as any[]),
  ));

  const byInvoice = new Map<number, typeof lines>();
  for (const line of lines) {
    const list = byInvoice.get(line.invoiceId) ?? [];
    list.push(line); byInvoice.set(line.invoiceId, list);
  }
  const today = new Date();
  const todayOrdinal = denverDateOrdinal(today);
  const terms = broker.paymentTerms === "net15" ? 15 : broker.paymentTerms === "net45" ? 45 :
    broker.paymentTerms === "net60" ? 60 : 30;
  const dsos: number[] = [];
  let late = 0;
  let chargebacks = 0;
  let totalPaid = 0;
  let totalOutstanding = 0;
  const shortInvoices = new Set<number>();
  const unresolvedShortPayApplications = new Set(
    openPaymentExceptions
      .filter(exception => exception.type === "short_pay")
      .map(exception => exception.entityId)
      .filter((id): id is number => id != null),
  );
  const unresolvedInvoiceShortPays = new Set(
    openInvoiceExceptions
      .filter(exception => exception.type === "short_pay")
      .map(exception => exception.entityId)
      .filter((id): id is number => id != null),
  );
  for (const invoice of rows) {
    const amount = Number(invoice.amount);
    if (!invoice.fundedAt || amount <= 0) continue;
    let cumulativeCash = 0;
    let cumulativeSettlement = 0;
    let paidAt: Date | undefined;
    let settledAt: Date | undefined;
    let hasUnresolvedShortPay = unresolvedInvoiceShortPays.has(invoice.id);
    for (const line of byInvoice.get(invoice.id) ?? []) {
      const applied = Math.max(0, Number(line.appliedAmount));
      const writeOff = line.varianceType === "write_off"
        ? Math.max(0, Number(line.variance))
        : 0;
      if (!line.paymentDate) continue;
      cumulativeCash += applied;
      cumulativeSettlement += applied + writeOff;
      if (!paidAt && cumulativeCash + 0.005 >= amount) paidAt = line.paymentDate;
      if (!settledAt && cumulativeSettlement + 0.005 >= amount) settledAt = line.paymentDate;
      if (line.varianceType === "short_pay" && unresolvedShortPayApplications.has(line.cashApplicationId)) {
        hasUnresolvedShortPay = true;
      }
    }
    const dueOrdinal = invoice.dueDate
      ? denverDateOrdinal(invoice.dueDate)
      : denverDateOrdinal(invoice.fundedAt) + terms * DAY;
    const creditedPaid = Math.min(amount, cumulativeCash);
    const outstanding = Math.max(0, amount - cumulativeSettlement);
    totalPaid += creditedPaid;
    totalOutstanding += outstanding;
    if (outstanding > 0 && hasUnresolvedShortPay) shortInvoices.add(invoice.id);
    if (paidAt) {
      const dso = daysBetween(invoice.fundedAt, paidAt);
      dsos.push(dso);
    }
    if (settledAt) {
      if (denverDateOrdinal(settledAt) > dueOrdinal) late++;
    } else {
      // Open, positive AR contributes to reliability as a late invoice.
      if (outstanding > 0 && todayOrdinal > dueOrdinal) late++;
    }
    if (invoice.chargebackStatus === "charged" &&
        (!invoice.chargebackDate || invoice.chargebackDate <= today)) chargebacks++;
  }
  const shortPayCount = shortInvoices.size;
  const disputeCount = [...openInvoiceExceptions, ...openPaymentExceptions, ...openBrokerExceptions]
    .filter(exception => exception.type === "other").length;
  const paidInvoiceCount = dsos.length;
  const averageDaysToPay = paidInvoiceCount ? Math.round(dsos.reduce((a, b) => a + b, 0) / paidInvoiceCount) : null;
  const totalInvoices = rows.filter(invoice => invoice.fundedAt && Number(invoice.amount) > 0).length;
  const latePercent = totalInvoices ? Math.min(100, (late / totalInvoices) * 100) : 0;
  const paymentSpeedScore = points(averageDaysToPay ?? 91);
  const paymentReliabilityScore = reliabilityPoints(latePercent);
  const score = paymentSpeedScore + paymentReliabilityScore +
    chargebackPoints(chargebacks) + shortPayPoints(shortPayCount);
  const creditGrade = gradeFor(score) as "A" | "B" | "C" | "D" | "F";

  const [history] = await tx.insert(brokerCreditScores).values({
    brokerId, grade: creditGrade, score, paymentSpeedScore,
    paymentReliabilityScore, chargebackScore: chargebackPoints(chargebacks),
    shortPayScore: shortPayPoints(shortPayCount), avgDaysToPayment: averageDaysToPay,
    totalInvoices, totalPaid: totalPaid.toFixed(2), totalOutstanding: totalOutstanding.toFixed(2),
    totalChargebacks: chargebacks, totalShortPays: shortPayCount,
    totalDisputes: disputeCount, lateInvoiceCount: late, paidInvoiceCount,
  }).returning();
  await tx.update(brokers).set({ creditGrade, creditScore: score, updatedAt: new Date() })
    .where(eq(brokers.id, brokerId));
  return history;
}

export async function recalculateAllBrokerCredit() {
  const all = await db.select({ id: brokers.id }).from(brokers);
  return recalculateBrokerCreditBatch(all.map(broker => broker.id));
}

export async function recalculateBrokerCreditBatch(brokerIds: number[], concurrency = 12) {
  const results = new Array<Awaited<ReturnType<typeof recalculateBrokerCredit>>>(brokerIds.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < brokerIds.length) {
      const index = nextIndex++;
      results[index] = await recalculateBrokerCredit(brokerIds[index]);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), brokerIds.length) },
    () => worker(),
  ));
  return results;
}

export function recalculateBrokerCreditSafe(brokerId: number): void {
  recalculateBrokerCredit(brokerId).catch(error =>
    console.warn(`[brokerCredit] recalculation failed for broker ${brokerId}:`, error?.message ?? error));
}

let schedulerStarted = false;
let running = false;
export function startBrokerCreditScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  // node-cron is loaded lazily so importing the engine remains safe in jobs/tests.
  import("node-cron").then(({ default: cron }) => {
    const expression = process.env.BROKER_CREDIT_CRON ?? "0 0 * * *";
    if (!cron.validate(expression)) {
      console.warn(`[brokerCredit] Invalid cron expression "${expression}", scheduler not started.`);
      return;
    }
    cron.schedule(expression, async () => {
      if (running) return;
      running = true;
      let lockClient: any;
      try {
        lockClient = await pool.connect();
        const lockResult = await lockClient.query(
          "select pg_try_advisory_lock($1) as acquired",
          [742_091_731],
        );
        if (!lockResult.rows[0]?.acquired) return;
        await recalculateAllBrokerCredit();
      } catch (error) {
        console.error("[brokerCredit] scheduled recalculation failed:", error);
      } finally {
        if (lockClient) {
          await lockClient.query("select pg_advisory_unlock($1)", [742_091_731]).catch(() => {});
          lockClient.release();
        }
        running = false;
      }
    }, { timezone: "America/Denver" });
    console.log(`[brokerCredit] scheduler started — cron: ${expression}`);
  }).catch(error => console.warn("[brokerCredit] scheduler setup failed:", error?.message ?? error));
}