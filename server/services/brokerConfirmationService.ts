import { isProductionAppOrigin } from "../../shared/production-urls.js";
import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  invoices, brokers, clients, debtors, loads, users, tasks, paymentApplicationLines,
  brokerConfirmationEvents, brokerConfirmationSettings, eventLedger,
} from "../../shared/schema";
import { sendEmailTracked } from "../emailService";
import { emailDetailsTable, emailDisplayName, wrapEmail } from "../emailTemplate.js";
import { BROKER_PUBLIC_ORIGIN, brokerReceiptLinks, brokerReceiptActions, brokerPaperworkHtml, brokerPaperworkText } from "./brokerConfirmationPresentation";
import { brokerInvoicePaperwork } from "./brokerConfirmationDocuments";
import { brokerCollectionsService, confirmCollectionVpInTransaction, recordCollectionReceiptSend } from "./brokerCollections";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Store = typeof db | Tx;
export type ConfirmationStore = Store;
type Invoice = typeof invoices.$inferSelect;
type Event = typeof brokerConfirmationEvents.$inferInsert.event;
export type ConfirmationActor = { kind: "system" | "agent" | "broker"; id: string };
export type ConfirmationSettings = Pick<typeof brokerConfirmationSettings.$inferSelect, "maxReminders" | "reminderDays" | "publicBaseUrl"> & { chargebackWarningDays?: number; dumpStatementIntervalDays?: number };
const DAY = 86_400_000;
export const INITIAL_CONFIRMATION_DELAY_MS = 2 * DAY;

export class ConfirmationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function escapeConfirmationHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

export function fundedAgeDays(fundedAt: Date, now = new Date()): number {
  const day = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const part = (type: string) => Number(parts.find(value => value.type === type)?.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"));
  };
  return Math.max(0, Math.floor((day(now) - day(fundedAt)) / DAY));
}

export function confirmationAction(
  invoice: Pick<Invoice, "status" | "fundedAt" | "brokerConfirmationStatus" | "confirmationSentAt" | "confirmationRemindedCount">,
  settings: ConfirmationSettings, now: Date,
): "initial" | "reminder" | "escalate" | null {
  if (invoice.status !== "funded" || !invoice.fundedAt ||
      ["confirmed", "disputed"].includes(invoice.brokerConfirmationStatus)) return null;
  if (!invoice.confirmationSentAt) return invoice.fundedAt.getTime() < now.getTime() - INITIAL_CONFIRMATION_DELAY_MS ? "initial" : null;
  const elapsed = now.getTime() - invoice.confirmationSentAt.getTime();
  const count = invoice.confirmationRemindedCount;
  if (count < settings.maxReminders && elapsed >= settings.reminderDays[count] * DAY) return "reminder";
  if (count >= settings.maxReminders && elapsed >= settings.reminderDays[2] * DAY) return "escalate";
  return null;
}

export function createBrokerConfirmationService({
  store = db as Store,
  now = () => new Date(),
  send = sendEmailTracked,
}: { store?: Store; now?: () => Date; send?: typeof sendEmailTracked } = {}) {
  async function settings(): Promise<ConfirmationSettings> {
    const [row] = await store.select().from(brokerConfirmationSettings).where(eq(brokerConfirmationSettings.id, 1));
    if (!row) throw new ConfirmationError(503, "Broker confirmation settings have not been configured.");
    return { maxReminders: row.maxReminders, reminderDays: row.reminderDays,
      publicBaseUrl: isProductionAppOrigin(row.publicBaseUrl) ? BROKER_PUBLIC_ORIGIN : row.publicBaseUrl,
      chargebackWarningDays: row.chargebackWarningDays, dumpStatementIntervalDays: row.dumpStatementIntervalDays };
  }

  async function event(tx: Tx, invoiceId: number, kind: Event, actor: ConfirmationActor, notes: string | null, at: Date) {
    await tx.insert(brokerConfirmationEvents).values({
      invoiceId, event: kind, actor: actor.kind === "agent" ? `agent:${actor.id}` : actor.id, notes, createdAt: at,
    });
    // The invoice timeline remains event_ledger-only; the confirmation panel has its own requested log.
    await tx.insert(eventLedger).values({
      entityType: "invoice", entityId: invoiceId, eventType: `broker_confirmation_${kind}`,
      actorType: actor.kind === "agent" ? "user" : "system",
      actorId: actor.kind === "agent" ? actor.id : null,
      payloadJson: { label: `Broker confirmation: ${kind.replaceAll("_", " ")}`, notes, actor: actor.id },
      createdAt: at,
    });
  }

  async function task(tx: Tx, invoice: Invoice, kind: "missing_email" | "disputed" | "escalated", notes: string, at: Date) {
    const title = kind === "disputed" ? "Broker disputed invoice receipt" :
      kind === "missing_email" ? "Broker confirmation: missing contact email" : "Broker confirmation overdue";
    const [created] = await tx.insert(tasks).values({
      confirmationInvoiceId: invoice.id, confirmationKind: kind,
      title: `${title} — ${invoice.invoiceNumber}`, description: notes,
      type: "followup", priority: kind === "disputed" ? "urgent" : "high",
      assignedTo: invoice.assignedFollowupAgentId, clientId: invoice.clientId,
      dueDate: at, status: "todo", createdAt: at, updatedAt: at,
    }).onConflictDoNothing({ target: [tasks.confirmationInvoiceId, tasks.confirmationKind] }).returning();
    if (created && kind !== "disputed") {
      await event(tx, invoice.id, "escalated", { kind: "system", id: "system" }, notes, at);
    }
    return created;
  }

  async function lockedInvoice(tx: Tx, id: number, skipLocked = false) {
    const lock = await tx.execute(sql`select id from ${invoices} where id = ${id} for update ${skipLocked ? sql`skip locked` : sql``}`);
    if (!lock.rows.length) return null;
    const [row] = await tx.select({ invoice: invoices, brokerEmail: brokers.email, brokerName: brokers.name, carrierName: clients.name })
      .from(invoices).leftJoin(brokers, eq(invoices.brokerId, brokers.id))
      .leftJoin(clients, eq(invoices.clientId, clients.id)).where(eq(invoices.id, id));
    return row ?? null;
  }

  async function sendForInvoice(id: number, actor: ConfirmationActor, automatic = false) {
    if (send === sendEmailTracked && process.env.NODE_ENV !== "production") {
      throw new ConfirmationError(503, "Broker confirmation mail is disabled in Preview. Publish first so the email links reach the updated public confirmation pages.");
    }
    const config = await settings();
    const at = now();
    return store.transaction(async (tx: Tx) => {
      const row = await lockedInvoice(tx, id, automatic);
      if (!row) {
        if (automatic) return { message: "Invoice busy or removed.", skipped: true };
        throw new ConfirmationError(404, "Invoice not found.");
      }
      const invoice = row.invoice;
      const action = automatic ? confirmationAction(invoice, config, at) : "manual";
      if (!action) return { message: "No confirmation action due.", skipped: true };
      if (!invoice.fundedAt) throw new ConfirmationError(409, "Only funded invoices can request broker confirmation.");
      if (["confirmed", "disputed"].includes(invoice.brokerConfirmationStatus)) {
        throw new ConfirmationError(409, `Invoice receipt is already ${invoice.brokerConfirmationStatus}.`);
      }
      if (action === "escalate") {
        await task(tx, invoice, "escalated", `No broker confirmation after ${config.reminderDays[2]} days and ${invoice.confirmationRemindedCount} reminders. Contact the broker.`, at);
        return { message: "Assigned processor follow-up created." };
      }
      const email = row.brokerEmail?.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await task(tx, invoice, "missing_email", "No valid primary broker email on file. Add a broker contact email and follow up manually.", at);
        return { message: "Not sent: no valid broker email on file. Flagged for manual follow-up.", skipped: true };
      }
      if (!isProductionAppOrigin(config.publicBaseUrl)) {
        throw new ConfirmationError(503, "Set the published URL to https://factorflux.io in Factoring Settings. Development links cannot be emailed.");
      }
      const { confirm: confirmationUrl, dispute: disputeUrl } = brokerReceiptLinks(invoice.brokerConfirmationToken);
      const reminder = action === "reminder" ? invoice.confirmationRemindedCount + 1 : null;
      const subject = `${reminder ? `Reminder ${reminder}: ` : ""}Confirm invoice receipt — ${invoice.invoiceNumber}`;
      const details = [
        ["Internal invoice", invoice.invoiceNumber], ["Carrier invoice", invoice.carrierInvoiceNumber || "Not provided"],
        ["Load", invoice.loadNumber || "Not provided"], ["Amount", `$${Number(invoice.amount).toFixed(2)}`],
        ["Carrier", emailDisplayName(row.carrierName) || "Not provided"],
      ];
      const paperwork = await brokerInvoicePaperwork(tx, id, invoice.brokerConfirmationToken);
      const text = `Trucking Pros Financial\n${details.map(([label, value]) => `${label}: ${value}`).join("\n")}${brokerPaperworkText(paperwork)}\nConfirm Receipt: ${confirmationUrl}\nDispute: ${disputeUrl}\nOpening a link does not confirm receipt. Please use the button on the page.`;
      const html = wrapEmail(subject, `<p>Please confirm that you received this invoice, or report a dispute.</p>${emailDetailsTable(details as Array<[string, string]>)}${brokerPaperworkHtml(paperwork)}${brokerReceiptActions(invoice.brokerConfirmationToken)}`);
      const [acceptedSends] = await tx.select({ count: sql<string>`count(*)` }).from(brokerConfirmationEvents)
        .where(and(eq(brokerConfirmationEvents.invoiceId, id), inArray(brokerConfirmationEvents.event, ["sent", "reminder_sent"])));
      // Failed/uncertain manual attempts must reuse a key; only committed acceptance advances it.
      const key = automatic ? `broker-confirm/${invoice.brokerConfirmationToken}/${reminder ? `reminder-${reminder}` : "initial"}` :
        `broker-confirm/${invoice.brokerConfirmationToken}/manual-${Number(acceptedSends.count) + 1}`;
      const delivery = await send({ to: email, subject, text, html, idempotencyKey: key,
        emailLog: { entityType: "invoice", entityId: id, templateName: "broker_confirmation",
          confirmationReminder: reminder, sentByUserId: automatic || actor.kind !== "agent" ? null : actor.id } });
      if (!delivery.success || !delivery.messageId) throw new ConfirmationError(502, "Resend did not confirm acceptance. No confirmation status was changed.");
      await tx.update(invoices).set({
        brokerConfirmationStatus: "sent", confirmationSentAt: invoice.confirmationSentAt ?? at,
        confirmationRemindedCount: reminder ?? invoice.confirmationRemindedCount, updatedAt: at,
      }).where(eq(invoices.id, id));
      await recordCollectionReceiptSend(tx, invoice, at);
      await event(tx, id, reminder ? "reminder_sent" : "sent", actor,
        `${reminder ? `Reminder ${reminder}. ` : ""}${automatic ? "Automatic" : "Manual"} send accepted by Resend (${delivery.messageId}).`, at);
      await tx.update(tasks).set({ status: "completed", progress: 100, updatedAt: at })
        .where(and(eq(tasks.confirmationInvoiceId, id), eq(tasks.confirmationKind, "missing_email")));
      if (reminder === config.maxReminders && reminder === 3) {
        await task(tx, invoice, "escalated", "Third confirmation reminder sent without receipt confirmation. Contact the broker.", at);
      }
      return { message: reminder ? `Reminder ${reminder} accepted by Resend.` : "Confirmation email accepted by Resend." };
    });
  }

  async function recordEmailRetry(id: number, actor: ConfirmationActor, messageId: string, reminder: number | null) {
    const config = await settings(), at = now();
    return store.transaction(async (tx: Tx) => {
      const row = await lockedInvoice(tx, id);
      if (!row || ["confirmed", "disputed", "resolved"].includes(row.invoice.brokerConfirmationStatus)) return;
      if (row.invoice.confirmationSentAt && (!reminder || row.invoice.confirmationRemindedCount >= reminder)) return;
      await tx.update(invoices).set({
        brokerConfirmationStatus: "sent", confirmationSentAt: row.invoice.confirmationSentAt ?? at,
        confirmationRemindedCount: Math.max(row.invoice.confirmationRemindedCount, reminder ?? 0), updatedAt: at,
      }).where(eq(invoices.id, id));
      await event(tx, id, reminder ? "reminder_sent" : "sent", actor, `Email Log retry accepted by Resend (${messageId}).`, at);
      await recordCollectionReceiptSend(tx, row.invoice, at);
      await tx.update(tasks).set({ status: "completed", progress: 100, updatedAt: at })
        .where(and(eq(tasks.confirmationInvoiceId, id), eq(tasks.confirmationKind, "missing_email")));
      if (reminder === config.maxReminders && reminder === 3) {
        await task(tx, row.invoice, "escalated", "Third confirmation reminder accepted on Email Log retry. Contact the broker.", at);
      }
    });
  }

  async function publicInvoice(token: string, opened = false) {
    return store.transaction(async (tx: Tx) => {
      const [match] = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.brokerConfirmationToken, token));
      if (!match) throw new ConfirmationError(404, "This confirmation link is invalid.");
      const row = await lockedInvoice(tx, match.id);
      if (!row?.invoice.confirmationSentAt) throw new ConfirmationError(404, "This confirmation link is not active.");
      if (opened) {
        const [previous] = await tx.select({ id: brokerConfirmationEvents.id }).from(brokerConfirmationEvents)
          .where(and(eq(brokerConfirmationEvents.invoiceId, match.id), eq(brokerConfirmationEvents.event, "opened"))).limit(1);
        if (!previous) await event(tx, match.id, "opened", { kind: "broker", id: row.brokerEmail || "broker" }, "Confirmation page opened; receipt has NOT been confirmed.", now());
      }
      return {
        invoiceId: row.invoice.id, invoiceNumber: row.invoice.invoiceNumber, carrierInvoiceNumber: row.invoice.carrierInvoiceNumber,
        loadNumber: row.invoice.loadNumber, amount: row.invoice.amount, carrier: row.carrierName,
        status: row.invoice.brokerConfirmationStatus,
      };
    });
  }

  async function resolve(id: number, status: "confirmed" | "disputed", actor: ConfirmationActor, notes: string, token?: string) {
    const at = now();
    return store.transaction(async (tx: Tx) => {
      const row = await lockedInvoice(tx, id);
      if (!row) throw new ConfirmationError(404, "Invoice not found.");
      const invoice = row.invoice;
      if (token && (invoice.brokerConfirmationToken !== token || !invoice.confirmationSentAt)) throw new ConfirmationError(404, "This confirmation link is invalid.");
      if (!invoice.fundedAt) throw new ConfirmationError(409, "The invoice has not been funded.");
      if (invoice.brokerConfirmationStatus === status) return { message: status === "confirmed" ? "Receipt is already confirmed. Thank you." : "This dispute has already been recorded." };
      if (actor.kind === "broker" && ["confirmed", "disputed"].includes(invoice.brokerConfirmationStatus)) {
        throw new ConfirmationError(409, `Receipt has already been ${invoice.brokerConfirmationStatus}. Contact Trucking Pros Financial to make a correction.`);
      }
      await tx.update(invoices).set({
        brokerConfirmationStatus: status, brokerConfirmedAt: status === "confirmed" ? at : null, updatedAt: at,
      }).where(eq(invoices.id, id));
      await event(tx, id, status, actor, notes || null, at);
      if (status === "confirmed" && actor.kind === "agent") await confirmCollectionVpInTransaction(tx, invoice, actor.id, at);
      if (status === "disputed") await task(tx, invoice, "disputed", notes || "Broker disputed invoice receipt. Contact the broker urgently.", at);
      else await tx.update(tasks).set({ status: "completed", progress: 100, updatedAt: at })
        .where(eq(tasks.confirmationInvoiceId, id));
      return { message: status === "confirmed" ? "Receipt confirmed. Thank you." : "Dispute recorded. Please contact Trucking Pros Financial." };
    });
  }

  async function brokerRespond(token: string, status: "confirmed" | "disputed", notes: string) {
    const [row] = await store.select({ invoice: invoices, email: brokers.email, name: brokers.name }).from(invoices)
      .leftJoin(brokers, eq(invoices.brokerId, brokers.id)).where(eq(invoices.brokerConfirmationToken, token));
    if (!row) throw new ConfirmationError(404, "This confirmation link is invalid.");
    return resolve(row.invoice.id, status, { kind: "broker", id: `${row.name || "Broker"}${row.email ? ` <${row.email.trim()}>` : ""}` }, notes, token);
  }

  async function details(id: number) {
    const [row] = await store.select({
      invoiceId: invoices.id, status: invoices.brokerConfirmationStatus, sentAt: invoices.confirmationSentAt,
      confirmedAt: invoices.brokerConfirmedAt, remindedCount: invoices.confirmationRemindedCount,
      assignedAgentId: invoices.assignedFollowupAgentId,
      assignedAgentName: sql<string | null>`nullif(concat_ws(' ', ${users.firstName}, ${users.lastName}), '')`,
      email: brokers.email, fundedAt: invoices.fundedAt,
    }).from(invoices).leftJoin(brokers, eq(invoices.brokerId, brokers.id))
      .leftJoin(users, eq(invoices.assignedFollowupAgentId, users.id)).where(eq(invoices.id, id));
    if (!row) throw new ConfirmationError(404, "Invoice not found.");
    const events = await store.select().from(brokerConfirmationEvents)
      .where(eq(brokerConfirmationEvents.invoiceId, id)).orderBy(asc(brokerConfirmationEvents.createdAt), asc(brokerConfirmationEvents.id));
    const { email, fundedAt, ...safe } = row;
    const previewMailDisabled = send === sendEmailTracked && process.env.NODE_ENV !== "production";
    const response = [...events].reverse().find(event => event.event === "confirmed" || event.event === "disputed");
    return { ...safe, respondedAt: response?.createdAt ?? null, respondedBy: response?.actor ?? null,
      disputedAt: response?.event === "disputed" ? response.createdAt : null,
      emailOnFile: !!email?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()),
      canResend: !previewMailDisabled && !!fundedAt && !["confirmed", "disputed"].includes(row.status),
      deliveryNotice: previewMailDisabled ? "Broker confirmation mail is disabled in Preview. Publish first so the email links reach the updated public confirmation pages."
        : !fundedAt ? "Fund this invoice before sending a broker receipt request." : null,
      canMarkConfirmed: !!fundedAt && row.status !== "confirmed", events };
  }

  async function reassign(id: number, agentId: string | null, actor: ConfirmationActor) {
    return store.transaction(async (tx: Tx) => {
      if (agentId) {
        const [agent] = await tx.select().from(users).where(and(eq(users.id, agentId), eq(users.status, "active"), eq(users.isTestAccount, false)));
        if (!agent || !["employee", "manager", "admin"].includes(agent.role)) throw new ConfirmationError(400, "Choose a real, active staff member.");
      }
      const row = await lockedInvoice(tx, id);
      if (!row) throw new ConfirmationError(404, "Invoice not found.");
      await tx.update(invoices).set({ assignedFollowupAgentId: agentId, updatedAt: now() }).where(eq(invoices.id, id));
      await tx.update(tasks).set({ assignedTo: agentId, updatedAt: now() })
        .where(and(eq(tasks.confirmationInvoiceId, id), inArray(tasks.status, ["todo", "in_progress", "held"])));
      await tx.insert(eventLedger).values({
        entityType: "invoice", entityId: id, eventType: "broker_confirmation_agent_reassigned",
        actorType: "user", actorId: actor.id,
        payloadJson: { label: "Broker confirmation follow-up agent reassigned", from: row.invoice.assignedFollowupAgentId, to: agentId },
      });
      return { message: "Follow-up agent reassigned." };
    });
  }

  async function runScheduled(options: { invoiceIds?: number[] } = {}) {
    // The old scheduler's public adapter now uses the one VP/RPS engine.
    if (send === sendEmailTracked) return brokerCollectionsService.tick(options);
    const at = now();
    const candidates = await store.select({ id: invoices.id }).from(invoices).where(and(
      eq(invoices.status, "funded"), inArray(invoices.brokerConfirmationStatus, ["pending", "sent"]),
      isNotNull(invoices.fundedAt),
      or(isNotNull(invoices.confirmationSentAt),
        lt(invoices.fundedAt, new Date(at.getTime() - INITIAL_CONFIRMATION_DELAY_MS))),
      options.invoiceIds ? inArray(invoices.id, options.invoiceIds) : undefined,
    )).orderBy(asc(invoices.id));
    const result = { checked: candidates.length, processed: 0, errors: [] as Array<{ invoiceId: number; message: string }> };
    // Bounded serial delivery and row locks coordinate independent application processes.
    for (const candidate of candidates) {
      try { const outcome = await sendForInvoice(candidate.id, { kind: "system", id: "system" }, true); if (!("skipped" in outcome && outcome.skipped)) result.processed++; }
      catch (error) {
        result.errors.push({ invoiceId: candidate.id, message: error instanceof Error ? error.message : "Confirmation processing failed." });
      }
    }
    return result;
  }

  return { settings, details, sendForInvoice, recordEmailRetry, publicInvoice, brokerRespond, resolve, reassign, runScheduled };
}

export const brokerConfirmationService = createBrokerConfirmationService();

export async function getConfirmationInvoiceScope(user: { id: string; role: string }, store: Store = db) {
  if (user.role === "admin") return undefined;
  if (user.role === "employee") return or(eq(invoices.submittedBy, user.id), eq(invoices.assignedFollowupAgentId, user.id));
  const team = await store.select({ id: users.id }).from(users).where(or(
    eq(users.id, user.id), and(eq(users.createdBy, user.id), eq(users.status, "active")),
  ));
  const ids = team.map(member => member.id);
  if (!ids.includes(user.id)) ids.push(user.id);
  return or(inArray(invoices.submittedBy, ids), inArray(invoices.assignedTo, ids), inArray(invoices.assignedFollowupAgentId, ids));
}

export async function getConfirmationAgingRows(scope?: ReturnType<typeof eq>, store: Store = db, at = new Date()) {
  const rows = await store.select({
    invoiceId: invoices.id, invoiceNumber: invoices.invoiceNumber, amount: invoices.amount,
    carrierId: invoices.clientId, brokerId: invoices.brokerId, debtorId: invoices.debtorId,
    status: invoices.status, loadType: invoices.loadType,
    loadNumber: sql<string | null>`coalesce(${invoices.loadNumber}, ${loads.loadNumber})`,
    carrier: clients.name, broker: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`, fundedAt: invoices.fundedAt,
    confirmationStatus: invoices.brokerConfirmationStatus,
    applied: sql<string>`coalesce((select sum(${paymentApplicationLines.appliedAmount} + case when ${paymentApplicationLines.varianceType} = 'write_off' then abs(coalesce(${paymentApplicationLines.variance},0)) else 0 end) from ${paymentApplicationLines} where ${paymentApplicationLines.invoiceId} = ${invoices.id}), 0)`,
  }).from(invoices).leftJoin(clients, eq(invoices.clientId, clients.id)).leftJoin(brokers, eq(invoices.brokerId, brokers.id))
    .leftJoin(debtors, eq(invoices.debtorId, debtors.id)).leftJoin(loads, eq(invoices.loadId, loads.id))
    .where(and(isNotNull(invoices.fundedAt), inArray(invoices.status, ["funded", "held"]), scope)).orderBy(asc(invoices.fundedAt));
  return rows.flatMap(({ applied, ...row }) => {
    const outstanding = Math.max(0, Number(row.amount) - Number(applied));
    return outstanding > 0 && row.fundedAt ? [{ ...row, amount: Number(row.amount), outstanding: Math.round(outstanding * 100) / 100, ageDays: fundedAgeDays(row.fundedAt, at) }] : [];
  });
}


// Legacy scheduler implementation is intentionally not exported or started.
