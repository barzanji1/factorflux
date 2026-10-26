import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  brokerConfirmationSettings, brokerDumpStatements, brokerDumpStatementCursors, brokers,
  emailLog, emailRetryPayloads, eventLedger, invoices,
} from "../../shared/schema";
import { dumpStatementDueAt, isDumpLoad, type DumpStatementInvoice } from "../../shared/dump-statements";
import { getConfirmationAgingRows } from "./brokerConfirmationService";
import { renderDumpStatementPdf } from "./dumpStatementPdf";
import { uploadToS3, downloadFromS3 } from "./s3Service";
import { ResendDeliveryError, sendResendEmail } from "../resendTransport.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Store = typeof db | Tx;
type Statement = typeof brokerDumpStatements.$inferSelect;
const ACTIVE = ["sending", "failed", "uncertain"] as const;
export const DUMP_STATEMENT_TEMPLATE = "broker_dump_statement";

async function openDumpInvoices(store: Store, brokerId: number, at: Date): Promise<DumpStatementInvoice[]> {
  return (await getConfirmationAgingRows(eq(invoices.brokerId, brokerId), store, at))
    .filter(row => isDumpLoad(row.loadType)).map(row => ({
      invoiceId: row.invoiceId, invoiceNumber: row.invoiceNumber, loadNumber: row.loadNumber,
      carrier: row.carrier || "Unknown carrier", amount: row.amount.toFixed(2), balance: row.outstanding.toFixed(2),
      fundedAt: row.fundedAt!.toISOString(),
    })).sort((a, b) => a.invoiceId - b.invoiceId);
}
// PostgreSQL JSONB reorders object keys; compare an explicit field projection,
// never JSON.stringify(rawRow) against a freshly constructed object.
const fingerprint = (rows: DumpStatementInvoice[]) => JSON.stringify(rows.map(row => [
  row.invoiceId, row.invoiceNumber, row.loadNumber, row.carrier, row.amount, row.balance, row.fundedAt,
]));
const unchanged = (left: DumpStatementInvoice[], right: DumpStatementInvoice[]) => fingerprint(left) === fingerprint(right);
async function timeline(store: Store, job: Statement, type: "sent" | "failed" | "skipped", error?: string) {
  await store.insert(eventLedger).values({
    entityType: "broker", entityId: job.brokerId, eventType: `broker_dump_statement_${type}`, actorType: "system", actorId: "system",
    payloadJson: {
      label: `Dump-load aging statement ${type}`, statementId: job.id, invoiceCount: job.invoiceSnapshot.length,
      totalBalance: job.totalBalance, ...(error ? { error } : {}),
    },
  });
}
async function skipStatement(store: Store, job: Statement, reason: string) {
  await store.update(brokerDumpStatements).set({ status: "skipped", error: reason }).where(eq(brokerDumpStatements.id, job.id));
  await store.update(brokerDumpStatementCursors).set({ activeStatementId: null })
    .where(eq(brokerDumpStatementCursors.activeStatementId, job.id));
  await timeline(store, job, "skipped", reason);
}

/** Provider acceptance and cursor advancement are atomic and idempotent.
 * Called by both the sender and verified-email reconciliation after lost responses. */
export async function recordDumpStatementSent(id: string, messageId: string, store: Store = db, at = new Date()) {
  await store.transaction(async tx => {
    const [job] = await tx.select().from(brokerDumpStatements).where(eq(brokerDumpStatements.id, id)).for("update");
    if (!job || job.status === "sent") return;
    await tx.update(brokerDumpStatements).set({ status: "sent", sentAt: at, messageId, error: null })
      .where(eq(brokerDumpStatements.id, id));
    await tx.update(brokerDumpStatementCursors).set({ lastStatementAt: at, activeStatementId: null })
      .where(eq(brokerDumpStatementCursors.activeStatementId, id));
    await timeline(tx, job, "sent");
  });
}

async function acceptance(store: Store, id: string) {
  const [row] = await store.select({ messageId: emailLog.resendMessageId, at: emailLog.createdAt })
    .from(emailRetryPayloads).innerJoin(emailLog, eq(emailLog.id, emailRetryPayloads.emailLogId))
    .where(and(sql`${emailRetryPayloads.deliveryContext}->>'dumpStatementId' = ${id}`, isNotNull(emailLog.resendMessageId)))
    .orderBy(asc(emailLog.id)).limit(1);
  return row?.messageId ? row : null;
}

async function claim(store: Store, brokerId: number, intervalDays: number, now: Date) {
  return store.transaction(async tx => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(706019, ${brokerId}) as locked`);
    if (!lock.rows[0]?.locked) return null;
    const [broker] = await tx.select().from(brokers).where(eq(brokers.id, brokerId));
    if (!broker) return null;
    const snapshot = await openDumpInvoices(tx, brokerId, now);
    const [existing] = await tx.select().from(brokerDumpStatements)
      .where(and(eq(brokerDumpStatements.brokerId, brokerId), inArray(brokerDumpStatements.status, [...ACTIVE]))).for("update");
    if (existing) {
      const accepted = await acceptance(tx, existing.id);
      if (accepted?.messageId) {
        await recordDumpStatementSent(existing.id, accepted.messageId, tx, accepted.at);
        return null;
      }
      if (existing.status !== "failed") {
        if (existing.status === "sending" && now.getTime() - existing.attemptStartedAt.getTime() > 10 * 60_000) {
          await tx.update(brokerDumpStatements).set({ status: "uncertain", error: "Interrupted delivery; waiting for verified provider acceptance. No automatic resend." })
            .where(eq(brokerDumpStatements.id, existing.id));
          await timeline(tx, existing, "failed", "Interrupted delivery; acceptance is uncertain. Automatic resend blocked.");
        }
        return null; // Never mint another key while acceptance is uncertain.
      }
      if (unchanged(snapshot, existing.invoiceSnapshot) && existing.recipient === (broker.email?.trim() || "")
        && existing.intervalDays === intervalDays && snapshot.length) {
        const [retry] = await tx.update(brokerDumpStatements).set({ status: "sending", error: null, attemptStartedAt: now })
          .where(eq(brokerDumpStatements.id, existing.id)).returning();
        return retry;
      }
      await skipStatement(tx, existing, "Balance, documents, recipient or interval changed before acceptance; obsolete statement cancelled.");
    }
    if (!snapshot.length) return null;
    const cursors = await tx.select().from(brokerDumpStatementCursors)
      .where(inArray(brokerDumpStatementCursors.invoiceId, snapshot.map(row => row.invoiceId)));
    const byInvoice = new Map(cursors.map(row => [row.invoiceId, row]));
    const triggers = snapshot.flatMap(invoice => {
      const cursor = byInvoice.get(invoice.invoiceId);
      if (cursor?.activeStatementId) return [];
      const fundedAt = new Date(invoice.fundedAt);
      const lastSent = cursor?.fundedAt.getTime() === fundedAt.getTime() ? cursor.lastStatementAt : null;
      const due = dumpStatementDueAt(fundedAt, intervalDays, now, lastSent);
      return due ? [{ invoiceId: invoice.invoiceId, fundedAt: invoice.fundedAt, dueAt: due.toISOString() }] : [];
    });
    if (!triggers.length) return null;
    const cents = snapshot.reduce((sum, row) => sum + Math.round(Number(row.balance) * 100), 0);
    if (!Number.isSafeInteger(cents) || cents <= 0) return null;
    const id = randomUUID();
    const [job] = await tx.insert(brokerDumpStatements).values({
      id, brokerId, brokerName: broker.name, recipient: broker.email?.trim() || "", intervalDays,
      statementAt: now, totalBalance: (cents / 100).toFixed(2), invoiceSnapshot: snapshot, triggers,
      s3Key: `broker-statements/dump/${brokerId}/${id}.pdf`, status: "sending", attemptStartedAt: now,
    }).returning();
    for (const trigger of triggers) {
      const previous = byInvoice.get(trigger.invoiceId);
      const lastStatementAt = previous?.fundedAt.toISOString() === trigger.fundedAt ? previous.lastStatementAt : null;
      await tx.insert(brokerDumpStatementCursors).values({
        invoiceId: trigger.invoiceId, fundedAt: new Date(trigger.fundedAt), activeStatementId: id, lastStatementAt,
      }).onConflictDoUpdate({ target: brokerDumpStatementCursors.invoiceId,
        set: { fundedAt: new Date(trigger.fundedAt), activeStatementId: id, lastStatementAt } });
    }
    return job;
  });
}

export interface DumpStatementOptions {
  store?: Store;
  now?: () => Date;
  brokerIds?: number[];
  send?: typeof sendResendEmail;
  render?: typeof renderDumpStatementPdf;
  upload?: typeof uploadToS3;
  download?: typeof downloadFromS3;
  sleep?: (milliseconds: number) => Promise<void>;
}
export async function processDumpStatements(options: DumpStatementOptions = {}) {
  const result = { sent: 0, failed: 0, skipped: 0, blockedInPreview: false, errors: [] as { brokerId: number; message: string }[] };
  // Tests inject a transport; no public endpoint or setting can bypass this guard.
  if (process.env.NODE_ENV !== "production" && !options.send) return { ...result, blockedInPreview: true };
  const store = options.store ?? db, now = options.now ?? (() => new Date());
  const send = options.send ?? sendResendEmail;
  const [settings] = await store.select({ days: brokerConfirmationSettings.dumpStatementIntervalDays })
    .from(brokerConfirmationSettings).where(eq(brokerConfirmationSettings.id, 1));
  const interval = settings?.days ?? 10;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw new Error("Invalid dump statement interval.");
  const candidates = await store.execute(sql`
    SELECT DISTINCT broker_id AS id FROM invoices
      WHERE broker_id IS NOT NULL AND funded_at <= ${new Date(now().getTime() - interval * 86_400_000)}
        AND status IN ('funded','held') AND load_type IN ('dump','dump_truck_ticket')
    UNION SELECT broker_id AS id FROM broker_dump_statements WHERE status IN ('sending','failed','uncertain')
    ORDER BY id`);
  const ids = (candidates.rows as { id: number }[]).map(row => row.id).filter(id => !options.brokerIds || options.brokerIds.includes(id));
  for (const brokerId of ids) {
    const job = await claim(store, brokerId, interval, now());
    if (!job) { result.skipped++; continue; }
    let providerStarted = false;
    let providerAccepted = false;
    try {
      const outcome = await store.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(706019, ${brokerId})`);
        const [current] = await tx.select().from(brokerDumpStatements).where(eq(brokerDumpStatements.id, job.id)).for("update");
        if (!current || current.status !== "sending") return false;
        // Payments/paid transitions must wait until this broker's snapshot is
        // accepted. Locks are targeted to this broker, never a global table lock.
        await tx.execute(sql`select id from invoices where broker_id = ${brokerId} order by id for update`);
        const snapshot = await openDumpInvoices(tx, brokerId, now());
        const [broker] = await tx.select({ email: brokers.email }).from(brokers).where(eq(brokers.id, brokerId));
        if (!snapshot.length || !unchanged(snapshot, current.invoiceSnapshot) || current.recipient !== broker?.email?.trim()) {
          await skipStatement(tx, current, "Open balances or broker contact changed before sending.");
          return false;
        }
        if (!z.string().email().safeParse(current.recipient).success) throw new ResendDeliveryError(400, "Broker has no valid email address.", false);
        const pdf = current.pdfStoredAt
          ? await (options.download ?? downloadFromS3)(current.s3Key)
          : await (options.render ?? renderDumpStatementPdf)(current);
        if (!current.pdfStoredAt) {
          await (options.upload ?? uploadToS3)(pdf, current.s3Key, "application/pdf");
          await tx.update(brokerDumpStatements).set({ pdfStoredAt: now() }).where(eq(brokerDumpStatements.id, current.id));
        }
        const balance = Number(current.totalBalance).toLocaleString("en-US", { style: "currency", currency: "USD" });
        const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", dateStyle: "medium" }).format(current.statementAt);
        providerStarted = true;
        try {
          const messageId = await send({
            to: current.recipient, subject: `TPF Dump-Load Aging Statement — ${date}`,
            text: `Please find attached your dump-load aging statement as of ${date}. It includes all ${current.invoiceSnapshot.length} open dump-load invoices. Total balance owed: ${balance}. Please remit payment for the outstanding balance. Reply to this email with any questions.`,
            idempotencyKey: `broker-dump-statement/${current.id}`,
            attachments: [{ filename: `TPF_Dump_Statement_${current.id}.pdf`, type: "application/pdf",
              content: pdf.toString("base64"), s3Key: current.s3Key }],
            emailLog: { templateName: DUMP_STATEMENT_TEMPLATE, entityType: "broker", entityId: brokerId,
              sentByUserId: null, dumpStatementId: current.id },
          });
          providerAccepted = true;
          await recordDumpStatementSent(current.id, messageId, tx, now());
          return true;
        } catch (error) {
          if (providerAccepted) throw error; // Acceptance reconciliation repairs a rolled-back acknowledgement.
          return { error }; // Preserve the generated PDF and durable attempt on definite provider rejection.
        }
      });
      if (typeof outcome === "object") throw outcome.error;
      if (outcome) result.sent++; else result.skipped++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dump statement failed.";
      const uncertain = providerStarted && (providerAccepted || !(error instanceof ResendDeliveryError) || error.uncertain);
      await store.transaction(async tx => {
        const changed = await tx.update(brokerDumpStatements).set({ status: uncertain ? "uncertain" : "failed", error: message })
          .where(and(eq(brokerDumpStatements.id, job.id), eq(brokerDumpStatements.status, "sending"))).returning();
        if (changed.length) await timeline(tx, changed[0], "failed", message);
      });
      result.failed++;
      result.errors.push({ brokerId, message });
    }
    if (result.sent) await (options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))))(2000);
  }
  return result;
}
