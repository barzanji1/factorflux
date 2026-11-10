import { isProductionAppOrigin } from "../../shared/production-urls.js";
import { DEFAULT_PAGE_SIZE } from "../../shared/pagination";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNotNull, lte, notExists, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  brokerCollectionSettings as settingsTable, brokerCollectionStates as states,
  brokerCollectionEvents as events, brokerConfirmationEvents, brokerConfirmationSettings,
  invoices, brokers, clients, users, notifications, eventLedger,
} from "../../shared/schema";
import { collectionActionSchema, collectionSettingsSchema, type CollectionQueue, type CollectionRow,
  type CollectionRunResult, type CollectionRunError } from "../../shared/broker-collections";
import { sendResendEmail, ResendDeliveryError, type ResendEmailParams } from "../resendTransport.js";
import { emailDetailsTable, wrapEmail } from "../emailTemplate.js";
import { brokerReceiptActions, brokerReceiptLinks } from "./brokerConfirmationPresentation";
import { brokerPaperwork, brokerPaperworkBody } from "./brokerPaperwork";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Store = Pick<typeof db, "select" | "insert" | "update" | "transaction" | "execute">;
type Invoice = typeof invoices.$inferSelect;
type State = typeof states.$inferSelect;
export const COLLECTION_DAY = 86_400_000;
const DAY = COLLECTION_DAY;
export class CollectionError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export const PREVIEW_LIVE_EMAIL_NOTICE = "Live broker emails are blocked in Preview — test in production.";
type InvoiceResult = false | { kind: "success"; outcome: "sent" | "simulated" | "notified" | "updated" } |
  { kind: "failure"; error: CollectionRunError };
export function collectionRunHttpStatus(result: CollectionRunResult) {
  return result.failed ? (result.errors.some(error => error.code === "preview_live_blocked") ? 503 : 502) : 200;
}

export function nextCollectionAction(state: Pick<State, "phase" | "vpAttempts" | "rpsAttempts" | "escalatedPhase">) {
  if (state.escalatedPhase === state.phase || !["vp", "rps"].includes(state.phase)) return null;
  const count = state.phase === "vp" ? state.vpAttempts : state.rpsAttempts;
  return { step: `${state.phase}_${count < (state.phase === "vp" ? 2 : 3) ? count + 1 : "escalation"}`,
    escalation: count >= (state.phase === "vp" ? 2 : 3) };
}

async function audit(tx: Store, invoiceId: number, type: string, payload: object, at: Date, actorId?: string) {
  await tx.insert(eventLedger).values({
    entityType: "invoice", entityId: invoiceId, eventType: `broker_collections_${type}`,
    actorType: actorId ? "user" : "system", actorId: actorId ?? null, createdAt: at,
    payloadJson: { label: `Broker collections: ${type.replaceAll("_", " ")}`, ...payload },
  });
}

/** Enrolment is durable and idempotent. Dry runs never change the financial invoice. */
export async function ensureCollectionState(store: Store, invoice: Invoice, at = new Date()) {
  const [existing] = await store.select().from(states).where(eq(states.invoiceId, invoice.id));
  if (existing) return existing;
  if (!invoice.fundedAt || !["funded", "held"].includes(invoice.status)) return null;
  const [config] = await store.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (!config) throw new CollectionError(503, "Collections settings are not configured.");
  // Adopt prior real confirmation sends instead of sending a second +48h email.
  const accepted = config.mode === "live" && invoice.confirmationSentAt ? Math.min(2, 1 + invoice.confirmationRemindedCount) : 0;
  const [agentConfirmation] = config.mode === "live" ? await store.select().from(brokerConfirmationEvents)
    .where(and(eq(brokerConfirmationEvents.invoiceId, invoice.id), eq(brokerConfirmationEvents.event, "confirmed"),
      ilike(brokerConfirmationEvents.actor, "agent:%"))).orderBy(desc(brokerConfirmationEvents.createdAt)).limit(1) : [];
  const anchor = agentConfirmation?.createdAt ?? null;
  const [created] = await store.insert(states).values({
    invoiceId: invoice.id, mode: config.mode, fundedAt: invoice.fundedAt,
    phase: anchor ? "rps" : "vp", vpConfirmedAt: anchor,
    vpAttempts: accepted, lastSentAt: accepted ? invoice.confirmationSentAt : null,
    nextActionAt: anchor ? new Date(anchor.getTime() + 20 * DAY) :
      accepted >= 2 ? at : new Date(invoice.fundedAt.getTime() + (accepted ? 4 : 2) * DAY),
    updatedAt: at,
  }).onConflictDoNothing().returning();
  if (created) await audit(store, invoice.id, "enrolled", { mode: config.mode, adoptedVpSends: accepted, phase: created.phase }, at);
  return created ?? (await store.select().from(states).where(eq(states.invoiceId, invoice.id)))[0];
}

/** Called inside the existing agent-confirmation transaction; broker link opens never call it. */
export async function confirmCollectionVpInTransaction(store: Store, invoice: Invoice, actorId: string, at = new Date()) {
  const state = await ensureCollectionState(store, invoice, at);
  if (!state || state.mode !== "live" || state.phase !== "vp") return;
  await store.update(states).set({ phase: "rps", vpConfirmedAt: at, rpsAttempts: 0,
    nextActionAt: new Date(at.getTime() + 20 * DAY), escalatedPhase: null, lastSentAt: null, lastError: null, updatedAt: at })
    .where(eq(states.invoiceId, invoice.id));
  await audit(store, invoice.id, "vp_confirmed", { mode: state.mode, source: "agent_confirmation" }, at, actorId);
}

/** Existing manual receipt requests count towards VP only for live workflows. */
export async function recordCollectionReceiptSend(store: Store, invoice: Invoice, at: Date) {
  const state = await ensureCollectionState(store, invoice, at);
  if (!state || state.mode !== "live" || state.phase !== "vp") return;
  const count = Math.min(2, state.vpAttempts + 1);
  await store.update(states).set({ vpAttempts: count, lastSentAt: at,
    nextActionAt: count === 2 ? at : new Date(Math.max(state.fundedAt.getTime() + 4 * DAY, at.getTime() + 2 * DAY)),
    updatedAt: at }).where(eq(states.invoiceId, invoice.id));
}

/** Swappable payment-confirmation boundary; deliberately does not post cash or settle balances. */
export async function markCollectionPaid(store: Store, invoiceId: number, at: Date, source: string, actorId?: string) {
  await store.update(states).set({ phase: "paid", paidAt: at, paused: false, nextActionAt: null, escalatedPhase: null, lastError: null, updatedAt: at })
    .where(eq(states.invoiceId, invoiceId));
  await audit(store, invoiceId, "paid", { source }, at, actorId);
}

export function createBrokerCollectionsService({
  database = db, now = () => new Date(), send = sendResendEmail,
  escalationRecipient,
}: { database?: Store; now?: () => Date; send?: (params: ResendEmailParams) => Promise<string>;
  escalationRecipient?: (store: Store) => Promise<string> } = {}) {
  async function actor(id: string, store: Store = database) {
    const [user] = await store.select().from(users).where(eq(users.id, id));
    if (!user || user.status !== "active" || !["admin", "manager", "employee"].includes(user.role)) throw new CollectionError(403, "Active staff only.");
    return user;
  }
  async function scopeFor(id: string, store: Store = database): Promise<SQL | undefined> {
    const user = await actor(id, store);
    if (user.role === "admin") return undefined;
    const team = user.role === "manager" ? await store.select({ id: users.id }).from(users)
      .where(and(eq(users.createdBy, id), eq(users.status, "active"))) : [];
    const ids = [id, ...team.map(member => member.id)];
    return or(inArray(invoices.submittedBy, ids), inArray(invoices.assignedTo, ids), inArray(invoices.assignedFollowupAgentId, ids));
  }
  async function requireAdmin(id: string, store: Store = database) {
    if ((await actor(id, store)).role !== "admin") throw new CollectionError(403, "Administrators only.");
  }
  async function settings(actorId: string) {
    const user = await actor(actorId);
    const [config] = await database.select().from(settingsTable).where(eq(settingsTable.id, 1));
    if (!config) throw new CollectionError(503, "Collections settings are not configured.");
    const liveEmailsBlocked = process.env.NODE_ENV !== "production";
    return { enabled: config.enabled, mode: config.mode, updatedAt: config.updatedAt.toISOString(), canManage: user.role === "admin",
      liveEmailsBlocked, liveEmailNotice: liveEmailsBlocked ? PREVIEW_LIVE_EMAIL_NOTICE : null };
  }
  async function updateSettings(actorId: string, input: unknown) {
    const value = collectionSettingsSchema.parse(input);
    await database.transaction(async tx => {
      await requireAdmin(actorId, tx);
      const [previous] = await tx.select().from(settingsTable).where(eq(settingsTable.id, 1)).for("update");
      await tx.update(settingsTable).set({ enabled: value.enabled, mode: value.mode, updatedBy: actorId, updatedAt: now() })
        .where(eq(settingsTable.id, 1));
      await tx.insert(eventLedger).values({ entityType: "system", entityId: 1,
        eventType: "broker_collections_settings_changed", actorType: "user", actorId,
        payloadJson: { label: "Broker collections automation settings changed", from: previous, to: { enabled: value.enabled, mode: value.mode } } });
    });
    return settings(actorId);
  }
  function safeRow(row: { state: State; invoiceNumber: string; loadNumber: string | null; broker: string | null; carrier: string | null }, admin: boolean): CollectionRow {
    const s = row.state;
    return { invoiceId: s.invoiceId, invoiceNumber: row.invoiceNumber, loadNumber: row.loadNumber, broker: row.broker, carrier: row.carrier,
      phase: s.phase, mode: s.mode, paused: s.paused, escalatedPhase: s.escalatedPhase,
      vpAttempts: s.vpAttempts, rpsAttempts: s.rpsAttempts, fundedAt: s.fundedAt.toISOString(),
      nextActionAt: s.nextActionAt?.toISOString() ?? null, vpConfirmedAt: s.vpConfirmedAt?.toISOString() ?? null,
      paidAt: s.paidAt?.toISOString() ?? null, lastError: s.lastError, canManage: admin };
  }
  const rowSelect = { state: states, invoiceNumber: invoices.invoiceNumber, loadNumber: invoices.loadNumber, broker: brokers.name, carrier: clients.name };
  async function queue(actorId: string, input: { page?: number; pageSize?: number; q?: string; phase?: string } = {}): Promise<CollectionQueue> {
    const scope = await scopeFor(actorId);
    const page = input.page ?? 1, pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
    const where = and(scope,
      input.q ? or(ilike(invoices.invoiceNumber, `%${input.q}%`), ilike(invoices.loadNumber, `%${input.q}%`), ilike(brokers.name, `%${input.q}%`)) : undefined,
      input.phase === "escalated" ? isNotNull(states.escalatedPhase) : input.phase === "paused" ? eq(states.paused, true) :
        input.phase && ["vp", "rps", "paid", "stopped"].includes(input.phase) ? eq(states.phase, input.phase as State["phase"]) : undefined);
    const from = () => database.select(rowSelect).from(states).innerJoin(invoices, eq(states.invoiceId, invoices.id))
      .leftJoin(brokers, eq(invoices.brokerId, brokers.id)).leftJoin(clients, eq(invoices.clientId, clients.id));
    const [rows, [count], config] = await Promise.all([
      from().where(where).orderBy(asc(states.nextActionAt), asc(states.invoiceId)).limit(pageSize).offset((page - 1) * pageSize),
      database.select({ count: sql<number>`count(*)::int` }).from(states).innerJoin(invoices, eq(states.invoiceId, invoices.id))
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id)).where(where),
      settings(actorId),
    ]);
    return { rows: rows.map(row => safeRow(row, config.canManage)), total: count.count, page, pageSize, settings: config };
  }
  async function detail(actorId: string, invoiceId: number) {
    const scope = await scopeFor(actorId);
    const [row] = await database.select(rowSelect).from(states).innerJoin(invoices, eq(states.invoiceId, invoices.id))
      .leftJoin(brokers, eq(invoices.brokerId, brokers.id)).leftJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(eq(states.invoiceId, invoiceId), scope));
    if (!row) throw new CollectionError(404, "Collections invoice not found in your assigned scope.");
    const history = await database.select().from(events).where(eq(events.invoiceId, invoiceId))
      .orderBy(desc(events.occurredAt), desc(events.id)).limit(200);
    return { row: safeRow(row, (await actor(actorId)).role === "admin"), events: history.map(event => ({
      id: event.id, step: event.step, phase: event.phase, mode: event.mode, outcome: event.outcome,
      scheduledAt: event.scheduledAt?.toISOString() ?? null, occurredAt: event.occurredAt.toISOString(),
      recipient: event.recipient, providerMessageId: event.providerMessageId, error: event.error, details: event.details,
    })) };
  }
  async function action(actorId: string, invoiceId: number, input: unknown) {
    const value = collectionActionSchema.parse(input), at = now();
    await database.transaction(async tx => {
      const scope = await scopeFor(actorId, tx);
      // Same lock order as the worker and existing confirmation service: invoice, then workflow.
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), scope)).for("update");
      if (!invoice) throw new CollectionError(404, "Invoice not found in your assigned scope.");
      const state = await ensureCollectionState(tx, invoice, at);
      if (!state) throw new CollectionError(409, "Only funded invoices can enter collections.");
      if (value.action === "start_live") {
        await requireAdmin(actorId, tx);
        const [config] = await tx.select().from(settingsTable).where(eq(settingsTable.id, 1));
        if (!value.confirmLive || !config.enabled || config.mode !== "live") throw new CollectionError(409, "Enable live mode and explicitly confirm this invoice first.");
        if (state.mode === "live" || ["paid", "stopped"].includes(state.phase)) throw new CollectionError(409, "This workflow cannot be restarted live.");
        const accepted = invoice.confirmationSentAt ? Math.min(2, 1 + invoice.confirmationRemindedCount) : 0;
        await tx.update(states).set({ generation: state.generation + 1, mode: "live", phase: "vp", paused: false,
          vpAttempts: accepted, rpsAttempts: 0, vpConfirmedAt: null, paidAt: null, lastSentAt: invoice.confirmationSentAt,
          nextActionAt: accepted === 2 ? at : new Date(Math.max(at.getTime(), state.fundedAt.getTime() + (accepted ? 4 : 2) * DAY)),
          escalatedPhase: null, lastError: null, updatedAt: at }).where(eq(states.invoiceId, invoiceId));
      } else {
        if (["paid", "stopped"].includes(state.phase)) throw new CollectionError(409, "This sequence has already stopped.");
        const patch: Partial<typeof states.$inferInsert> = { updatedAt: at };
        if (value.action === "vp_confirmed") {
          if (state.phase !== "vp") throw new CollectionError(409, "VP is already confirmed.");
          Object.assign(patch, { phase: "rps", vpConfirmedAt: at, rpsAttempts: 0, lastSentAt: null,
            nextActionAt: new Date(at.getTime() + 20 * DAY), escalatedPhase: null, lastError: null });
          if (state.mode === "live") {
            await tx.update(invoices).set({ brokerConfirmationStatus: "confirmed", brokerConfirmedAt: at, updatedAt: at }).where(eq(invoices.id, invoiceId));
            await tx.insert(brokerConfirmationEvents).values({ invoiceId, event: "confirmed", actor: `agent:${actorId}`,
              notes: value.notes || "VP confirmed from collections queue.", createdAt: at });
          }
        } else if (value.action === "paid") {
          await markCollectionPaid(tx, invoiceId, at, "agent", actorId);
        } else if (value.action === "stop") {
          Object.assign(patch, { phase: "stopped", paused: false, nextActionAt: null, escalatedPhase: null, lastError: null });
        } else {
          Object.assign(patch, { paused: value.action === "pause", lastError: value.action === "resume" ? null : state.lastError });
        }
        await tx.update(states).set(patch).where(eq(states.invoiceId, invoiceId));
      }
      await tx.insert(events).values({ invoiceId, generation: state.generation, step: `control_${randomUUID()}`,
        phase: state.phase, mode: state.mode, outcome: "applied", occurredAt: at,
        details: { action: value.action, actorId, notes: value.notes } });
      await audit(tx, invoiceId, value.action, { notes: value.notes, mode: state.mode }, at, actorId);
    });
    return detail(actorId, invoiceId);
  }
  async function enrolBatch(invoiceIds?: number[]) {
    if (invoiceIds?.length === 0) return;
    const rows = await database.select().from(invoices).where(and(
      isNotNull(invoices.fundedAt), inArray(invoices.status, ["funded", "held"]),
      notExists(database.select({ id: states.invoiceId }).from(states).where(eq(states.invoiceId, invoices.id))),
      invoiceIds ? inArray(invoices.id, invoiceIds) : undefined,
    )).orderBy(asc(invoices.id)).limit(250);
    for (const invoice of rows) await database.transaction(async tx => { await ensureCollectionState(tx, invoice, now()); });
  }
  async function alan(store: Store) {
    if (escalationRecipient) return escalationRecipient(store);
    const rows = await store.select({ id: users.id }).from(users)
      .where(and(eq(users.status, "active"), eq(users.isTestAccount, false),
        sql`lower(trim(concat_ws(' ', ${users.firstName}, ${users.lastName}))) = 'alan karam'`));
    if (rows.length !== 1) throw new CollectionError(409, "Alan Karam must match exactly one active real staff account. Escalation not delivered.");
    return rows[0].id;
  }
  async function processInvoice(invoiceId: number): Promise<InvoiceResult> {
    return database.transaction(async (tx): Promise<InvoiceResult> => {
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(82651074) as acquired`);
      if (!lock.rows[0]?.acquired) return false;
      // Global controls are locked until provider acceptance: turning off waits for an in-flight send.
      const [config] = await tx.select().from(settingsTable).where(eq(settingsTable.id, 1)).for("update");
      if (!config?.enabled) return false;
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
      const [state] = await tx.select().from(states).where(eq(states.invoiceId, invoiceId)).for("update");
      if (!invoice || !state) return false;
      if (state.mode === "live" && config.mode !== "live") return false;
      const at = now();
      if (["paid", "settled"].includes(invoice.status) || invoice.factoringStage === "final_settlement") {
        await markCollectionPaid(tx, invoiceId, at, "invoice_terminal_state");
        return { kind: "success", outcome: "updated" };
      }
      if (invoice.status !== "funded" || state.paused || !state.nextActionAt || state.nextActionAt > at || ["paid", "stopped"].includes(state.phase)) return false;
      const due = nextCollectionAction(state);
      if (!due) return false;
      if (invoice.brokerConfirmationStatus === "disputed") {
        await tx.update(states).set({ paused: true, lastError: "Broker disputed receipt. Resolve the dispute before resuming.", updatedAt: at }).where(eq(states.invoiceId, invoiceId));
        await audit(tx, invoiceId, "paused_dispute", { mode: state.mode }, at);
        return { kind: "success", outcome: "updated" };
      }
      if (!due.escalation && state.mode === "live" && config.nextSendAt > at) return false;
      const [broker] = invoice.brokerId ? await tx.select().from(brokers).where(eq(brokers.id, invoice.brokerId)) : [];
      let recipient: string | null = null;
      const details = { brokerId: invoice.brokerId, broker: broker?.name ?? null, invoiceNumber: invoice.invoiceNumber,
        loadNumber: invoice.loadNumber, phase: state.phase, reason: state.phase === "vp" ? "VP — confirm receipt" : "RPS — payment status" };
      try {
        let providerMessageId: string | null = null;
        if (due.escalation) {
          recipient = await alan(tx);
          if (state.mode === "live") await tx.insert(notifications).values({
            userId: recipient, type: "warning", title: `Call broker: ${details.reason}`,
            message: `${broker?.name ?? "Broker not found"} — Invoice ${invoice.invoiceNumber}, Load ${invoice.loadNumber ?? "not provided"} — ${details.reason}`,
            entityType: "invoice", entityId: invoiceId, actionUrl: "/follow-up",
          });
          await tx.update(states).set({ escalatedPhase: state.phase as "vp" | "rps", nextActionAt: null, lastError: null, updatedAt: at }).where(eq(states.invoiceId, invoiceId));
        } else {
          recipient = broker?.email?.trim() ?? null;
          if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new CollectionError(400, "No valid broker email on file. Correct it and resume.");
          const number = state.phase === "vp" ? state.vpAttempts + 1 : state.rpsAttempts + 1;
          const [confirmationConfig] = await tx.select().from(brokerConfirmationSettings).where(eq(brokerConfirmationSettings.id, 1));
          let receiptLinks = "";
          let receiptHtml = "";
          if (state.phase === "vp") {
            if (!confirmationConfig) throw new CollectionError(503, "Configure the published broker confirmation URL first.");
            if (!isProductionAppOrigin(confirmationConfig.publicBaseUrl)) throw new CollectionError(503, "Set the published URL to https://factorflux.io in Factoring Settings. Development links cannot be emailed.");
            const links = brokerReceiptLinks(invoice.brokerConfirmationToken);
            receiptLinks = `\nConfirm receipt: ${links.confirm}\nDispute: ${links.dispute}\nOpening a link does not confirm receipt; use the confirmation button.`;
            receiptHtml = brokerReceiptActions(invoice.brokerConfirmationToken);
          }
          const subject = state.phase === "vp" ? `Confirm paperwork receipt — ${invoice.invoiceNumber} (follow-up ${number})` :
            `Payment status request — ${invoice.invoiceNumber} (day ${[20, 35, 40][number - 1]})`;
          const message = state.phase === "vp" ? "Please confirm you received the invoice and supporting paperwork." :
            `Has payment been sent? It has been ${[20, 35, 40][number - 1]} days since paperwork was verified. Please reply with payment status and remittance details.`;
          const text = `Trucking Pros Financial\n${message}\nInvoice: ${invoice.invoiceNumber}\nLoad: ${invoice.loadNumber ?? "Not provided"}\nAmount: $${Number(invoice.amount).toFixed(2)}${receiptLinks}`;
          if (state.mode === "live") {
            if (send === sendResendEmail && process.env.NODE_ENV !== "production") throw new CollectionError(503, PREVIEW_LIVE_EMAIL_NOTICE, "preview_live_blocked");
            const paperwork = brokerPaperworkBody(invoice.brokerConfirmationToken, await brokerPaperwork(tx, invoice));
            // Reuse the old initial confirmation intent, preventing duplicate +48h sends across rollout/recovery.
            const key = state.phase === "vp" && number === 1 ? `broker-confirm/${invoice.brokerConfirmationToken}/initial` :
              `broker-collections/${invoice.brokerConfirmationToken}/${state.generation}/${due.step}`;
            providerMessageId = await send({ to: recipient, subject, text: text + paperwork.text, idempotencyKey: key,
              html: wrapEmail(subject, `<p>${message}</p>${emailDetailsTable([["Invoice", invoice.invoiceNumber], ["Carrier invoice", invoice.carrierInvoiceNumber || "Not provided"], ["Load", invoice.loadNumber ?? "Not provided"], ["Amount", `$${Number(invoice.amount).toFixed(2)}`]])}${paperwork.html}${receiptHtml}<p>Please reply to this email with any questions.</p>`),
              emailLog: { entityType: "invoice", entityId: invoiceId, templateName: `broker_collections_${state.phase}`, sentByUserId: null } });
            if (!providerMessageId) throw new CollectionError(502, "Provider did not return an acceptance ID.");
            await tx.update(settingsTable).set({ nextSendAt: new Date(now().getTime() + 2000) }).where(eq(settingsTable.id, 1));
            if (state.phase === "vp") {
              await tx.update(invoices).set({ confirmationSentAt: invoice.confirmationSentAt ?? at,
                confirmationRemindedCount: Math.max(invoice.confirmationRemindedCount, number - 1),
                brokerConfirmationStatus: invoice.brokerConfirmationStatus === "pending" ? "sent" : invoice.brokerConfirmationStatus,
                updatedAt: at }).where(eq(invoices.id, invoiceId));
              await tx.insert(brokerConfirmationEvents).values({ invoiceId, event: number === 1 ? "sent" : "reminder_sent",
                actor: "system", notes: `VP follow-up ${number} accepted (${providerMessageId}).`, createdAt: at });
            }
          }
          const count = (state.phase === "vp" ? state.vpAttempts : state.rpsAttempts) + 1;
          const escalationNext = count >= (state.phase === "vp" ? 2 : 3);
          // Catch-up never emits multiple overdue emails at once.
          const target = state.phase === "vp" ? state.fundedAt.getTime() + 4 * DAY :
            (state.vpConfirmedAt?.getTime() ?? at.getTime()) + [20, 35, 40][count] * DAY;
          const next = escalationNext ? at : new Date(Math.max(target, at.getTime() + (state.phase === "vp" ? 2 : 1) * DAY));
          await tx.update(states).set({ ...(state.phase === "vp" ? { vpAttempts: count } : { rpsAttempts: count }),
            lastSentAt: at, nextActionAt: next, lastError: null, updatedAt: at }).where(eq(states.invoiceId, invoiceId));
        }
        const record = { invoiceId, generation: state.generation, step: due.step, phase: state.phase, mode: state.mode,
          outcome: state.mode === "dry_run" ? "simulated" : due.escalation ? "notified" : "sent",
          scheduledAt: state.nextActionAt, occurredAt: at, recipient, providerMessageId, error: null,
          details: { ...details, wouldSendEmail: !due.escalation, wouldNotifyAlan: due.escalation } };
        await tx.insert(events).values(record).onConflictDoUpdate({
          target: [events.invoiceId, events.generation, events.step], set: record,
        });
        await audit(tx, invoiceId, due.step, record, at);
        return { kind: "success", outcome: record.outcome as "sent" | "simulated" | "notified" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Collections processing failed.";
        const outcome = error instanceof ResendDeliveryError && error.uncertain ? "unconfirmed" : "failed";
        await tx.update(states).set({ paused: true, lastError: message, updatedAt: at }).where(eq(states.invoiceId, invoiceId));
        const record = { invoiceId, generation: state.generation, step: due.step, phase: state.phase, mode: state.mode,
          outcome, scheduledAt: state.nextActionAt, occurredAt: at, recipient, error: message, details };
        await tx.insert(events).values(record).onConflictDoUpdate({ target: [events.invoiceId, events.generation, events.step], set: record });
        await audit(tx, invoiceId, "error", { ...record }, at);
        return { kind: "failure", error: { invoiceId, invoiceNumber: invoice.invoiceNumber, step: due.step,
          message, outcome, status: error instanceof CollectionError ? error.status : 502,
          ...(error instanceof CollectionError && error.code ? { code: error.code } : {}) } };
      }
    });
  }
  async function tick(options: { invoiceIds?: number[] } = {}): Promise<CollectionRunResult> {
    await enrolBatch(options.invoiceIds);
    const [config] = await database.select().from(settingsTable).where(eq(settingsTable.id, 1));
    const result: CollectionRunResult = { status: config?.enabled ? "completed" : "disabled",
      message: config?.enabled ? "No due invoices. No emails sent." : "Automation is globally off. No emails sent.",
      checked: 0, processed: 0, sent: 0, simulated: 0, notified: 0, updated: 0, skipped: 0,
      failed: 0, errors: [], disabled: !config?.enabled };
    if (!config?.enabled || options.invoiceIds?.length === 0) return result;
    const due = await database.select({ id: states.invoiceId }).from(states).innerJoin(invoices, eq(states.invoiceId, invoices.id)).where(and(
      inArray(states.phase, ["vp", "rps"]), eq(states.paused, false),
      or(lte(states.nextActionAt, now()), inArray(invoices.status, ["paid", "settled"])),
      options.invoiceIds ? inArray(states.invoiceId, options.invoiceIds) : undefined,
    )).orderBy(asc(states.nextActionAt), asc(states.invoiceId)).limit(100);
    result.checked = due.length;
    for (const row of due) {
      try {
        const outcome = await processInvoice(row.id);
        if (outcome && outcome.kind === "failure") {
          result.errors.push(outcome.error);
        } else if (outcome) {
          result.processed++;
          result[outcome.outcome]++;
          // The persisted cooldown fences other workers; pacing lets this
          // bounded batch drain without skipping every later email.
          if (send === sendResendEmail && outcome.outcome === "sent") await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      catch (error) { result.errors.push({ invoiceId: row.id, message: error instanceof Error ? error.message : "Collections processing failed.",
        outcome: "failed", status: 500 }); }
    }
    result.failed = result.errors.length;
    result.skipped = result.checked - result.processed - result.failed;
    result.status = result.failed ? (result.processed ? "partial_failure" : "failed") : "completed";
    if (result.checked) result.message = `${result.failed ? (result.processed ? "Run partially failed" : "Run failed") : "Run complete"} — ${result.sent} emails accepted, ${result.simulated} simulated actions, ${result.notified} notifications, ${result.updated} state updates, ${result.failed} failed, ${result.skipped} skipped.`;
    return result;
  }
  return { settings, updateSettings, queue, detail, action, tick, enrolBatch };
}

export const brokerCollectionsService = createBrokerCollectionsService();
let timer: ReturnType<typeof setInterval> | undefined;
export function startBrokerCollectionsScheduler() {
  if (timer) return;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await brokerCollectionsService.tick();
      if (result.errors.length) console.error("[brokerCollections]", result.errors);
    } catch (error) { console.error("[brokerCollections] scheduler failed:", error); }
    finally { busy = false; }
  };
  void run();
  timer = setInterval(run, 15 * 60_000); timer.unref();
  console.log("[brokerCollections] VP/RPS scheduler started; persistent global controls, startup catch-up, 15min interval.");
}
