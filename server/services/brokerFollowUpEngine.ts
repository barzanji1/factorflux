/**
 * Broker Follow-Up Automation Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Historical cadence and explicit manual-send support.
 * Automatic funding/scheduler entry points now delegate to brokerCollections (VP/RPS).
 * Legacy scheduled rows are retained for history, not dispatched.
 * The historical cadence supported:
 *   1. Immediate   — sent at funding time
 *   2. Due Date    — sent on the invoice due date
 *   3. Overdue N   — sent N days after the due date (configurable, default 3 & 7)
 *   4. Weekly N    — sent weekly after the last overdue step (configurable count)
 *
 * All reminder instances are stored in `broker_follow_up_reminders` and
 * processed by a background scheduler (startReminderScheduler).
 *
 * Templates: subject/body are resolved from `broker_follow_up_templates` at
 * schedule-build time, with hardcoded strings as fallback if no template exists.
 *
 * Auto-Stop: checkAndStopCadence() cancels all pending reminders when the
 * invoice reaches a terminal state (paid, settled, exception, cash-applied,
 * or agent-suppressed).
 */

import { db } from "../db";
import {
  brokerFollowUps,
  brokerFollowUpReminders,
  brokerFollowUpTemplates,
  invoices,
  clients,
  brokers,
  debtors,
  eventLedger,
  exceptions,
  paymentApplicationLines,
  type CadenceConfig,
} from "../../shared/schema";
import { eq, and, lte, inArray, ne } from "drizzle-orm";
import { storage } from "../storage";
import { sendEmailTracked } from "../emailService";
import { paymentInstructions, configuredPaymentBody, textToEmailBody, emailDisplayName } from "../emailTemplate.js";
import { brokerCollectionsService, collectionRunHttpStatus } from "./brokerCollections";

// ─── Default cadence ──────────────────────────────────────────────────────────

export const DEFAULT_CADENCE: CadenceConfig = {
  sendImmediately: true,
  sendOnDueDate: true,
  overdueIntervals: [3, 7],
  weeklyCount: 4,
  paused: false,
};

// ─── Placeholder rendering ────────────────────────────────────────────────────

export interface TemplateVars {
  brokerName:          string;
  invoiceNumber:       string;
  loadNumber:          string;
  amountDue:           string;
  dueDate:             string;
  paymentInstructions: string;
  contactName:         string;
}

export function renderTemplate(text: string, vars: TemplateVars): string {
  return text
    .replace(/\{\{brokerName\}\}/g,          emailDisplayName(vars.brokerName))
    .replace(/\{\{invoiceNumber\}\}/g,        vars.invoiceNumber)
    .replace(/\{\{loadNumber\}\}/g,           vars.loadNumber)
    .replace(/\{\{amountDue\}\}/g,            vars.amountDue)
    .replace(/\{\{dueDate\}\}/g,              vars.dueDate)
    .replace(/\{\{paymentInstructions\}\}/g,  vars.paymentInstructions)
    .replace(/\{\{contactName\}\}/g,          vars.contactName);
}

// ─── Map reminder type → template trigger type ────────────────────────────────

function reminderTriggerType(reminderType: string): "immediate" | "due_date" | "overdue" | "escalation" {
  if (reminderType === "immediate") return "immediate";
  if (reminderType === "due_date")  return "due_date";
  if (/d_overdue$/.test(reminderType)) return "overdue";
  return "escalation";
}

// ─── Template cache (in-memory, refreshed per scheduler tick) ─────────────────

let _templateCache: Record<string, { subject: string; body: string } | null> = {};
let _cacheTs = 0;
const CACHE_TTL_MS = 60_000; // 1 min

async function getTemplate(
  triggerType: "immediate" | "due_date" | "overdue" | "escalation",
): Promise<{ subject: string; body: string } | null> {
  const now = Date.now();
  if (now - _cacheTs > CACHE_TTL_MS) {
    _templateCache = {};
    _cacheTs = now;
  }
  if (triggerType in _templateCache) return _templateCache[triggerType];

  const [tpl] = await db
    .select({ subject: brokerFollowUpTemplates.subject, body: brokerFollowUpTemplates.body })
    .from(brokerFollowUpTemplates)
    .where(
      and(
        eq(brokerFollowUpTemplates.triggerType, triggerType),
        eq(brokerFollowUpTemplates.isDefault, true),
      ),
    )
    .limit(1);

  _templateCache[triggerType] = tpl ?? null;
  return tpl ?? null;
}

export function invalidateTemplateCache() {
  _templateCache = {};
  _cacheTs = 0;
}

// ─── Label helpers ────────────────────────────────────────────────────────────

function reminderTypeLabel(type: string): string {
  if (type === "immediate")  return "Immediate (Funding)";
  if (type === "due_date")   return "Due Date";
  const odMatch = type.match(/^(\d+)d_overdue$/);
  if (odMatch) return `${odMatch[1]} Days Overdue`;
  const wkMatch = type.match(/^weekly_(\d+)$/);
  if (wkMatch) return `Weekly #${wkMatch[1]}`;
  return type;
}

// ─── Hardcoded fallback builders ──────────────────────────────────────────────

function fallbackSubject(
  type: string,
  weekNum: number,
  invoiceNumber: string,
  clientName: string,
): string {
  const tag = `[${clientName}]`;
  if (type === "immediate")  return `Payment Follow-Up — Invoice ${invoiceNumber} ${tag}`;
  if (type === "due_date")   return `Payment Due Today — Invoice ${invoiceNumber} ${tag}`;
  const odMatch = type.match(/^(\d+)d_overdue$/);
  if (odMatch) return `${odMatch[1]} Days Past Due — Invoice ${invoiceNumber} ${tag}`;
  return `Payment Still Outstanding — Invoice ${invoiceNumber} (Week ${weekNum}) ${tag}`;
}

function fallbackBody(
  type: string,
  seqNumber: number,
  weekNum: number,
  invoiceNumber: string,
  amount: string,
  loadNumber: string | null | undefined,
  clientName: string,
): string {
  const amtFmt = `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const urgencyLine =
    type === "immediate"     ? "The carrier advance has been processed and payment is now due." :
    type === "due_date"      ? "This invoice is due today. Please remit payment immediately." :
    type.includes("overdue") ? `This invoice is now ${type.replace("d_overdue","").replace("_","")} days past due. Immediate payment is required.` :
    `This is reminder #${seqNumber} — this invoice remains unpaid. Please contact us to resolve.`;

  return [
    "Dear Broker / Debtor,",
    "",
    `This is a payment follow-up (${reminderTypeLabel(type)}) from Trucking Pros Financial`,
    `regarding invoice ${invoiceNumber} for carrier ${emailDisplayName(clientName)}.`,
    "",
    `  Load #:           ${loadNumber ?? "N/A"}`,
    `  Invoice Amount:   ${amtFmt}`,
    "",
    urgencyLine,
    "",
    "Please remit at your earliest convenience or contact our collections team.",
    "",
    "Thank you,",
    "Trucking Pros Financial — Collections Team",
  ].join("\n");
}

// ─── Template-aware subject/body resolver ─────────────────────────────────────

async function resolveSubjectBody(
  reminderType: string,
  weekNum: number,
  seqNumber: number,
  invoiceNumber: string,
  amount: string,
  loadNumber: string | null | undefined,
  clientName: string,
  dueDate: Date | null,
  debtorName?: string,
): Promise<{ subject: string; body: string }> {
  const triggerType = reminderTriggerType(reminderType);
  const tpl = await getTemplate(triggerType);

  if (tpl) {
    const vars: TemplateVars = {
      brokerName:          debtorName ?? clientName,
      invoiceNumber,
      loadNumber:          loadNumber ?? "N/A",
      amountDue:           `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      dueDate:             dueDate ? dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A",
      paymentInstructions: paymentInstructions(),
      contactName:         "Collections Team",
    };
    return {
      subject: renderTemplate(tpl.subject, vars),
      body:    renderTemplate(tpl.body,    vars),
    };
  }

  return {
    subject: fallbackSubject(reminderType, weekNum, invoiceNumber, clientName),
    body:    fallbackBody(reminderType, seqNumber, weekNum, invoiceNumber, amount, loadNumber, clientName),
  };
}

// ─── Reminder schedule builder ────────────────────────────────────────────────

interface ReminderSpec {
  sequenceNumber: number;
  reminderType: string;
  intervalDays: number | null;
  scheduledSendAt: Date;
  subject: string;
  body: string;
  weekNum: number;
}

async function buildReminderSchedule(
  cadence: CadenceConfig,
  invoiceNumber: string,
  amount: string,
  loadNumber: string | null | undefined,
  clientName: string,
  dueDate: Date | null,
  debtorName?: string,
): Promise<ReminderSpec[]> {
  const specs: ReminderSpec[] = [];
  const now = new Date();
  const effectiveDue = dueDate ?? new Date(now.getTime() + 30 * 86_400_000);
  let seq = 1;

  // ① Immediate
  if (cadence.sendImmediately) {
    const { subject, body } = await resolveSubjectBody(
      "immediate", 0, seq, invoiceNumber, amount, loadNumber, clientName, dueDate, debtorName,
    );
    specs.push({ sequenceNumber: seq++, reminderType: "immediate", intervalDays: null, scheduledSendAt: now, subject, body, weekNum: 0 });
  }

  // ② Due date
  if (cadence.sendOnDueDate && effectiveDue > now) {
    const { subject, body } = await resolveSubjectBody(
      "due_date", 0, seq, invoiceNumber, amount, loadNumber, clientName, dueDate, debtorName,
    );
    specs.push({ sequenceNumber: seq++, reminderType: "due_date", intervalDays: 0, scheduledSendAt: new Date(effectiveDue), subject, body, weekNum: 0 });
  }

  // ③ Overdue intervals
  for (const days of cadence.overdueIntervals) {
    const sendAt = new Date(effectiveDue.getTime() + days * 86_400_000);
    const type   = `${days}d_overdue`;
    const { subject, body } = await resolveSubjectBody(
      type, 0, seq, invoiceNumber, amount, loadNumber, clientName, dueDate, debtorName,
    );
    specs.push({ sequenceNumber: seq++, reminderType: type, intervalDays: days, scheduledSendAt: sendAt, subject, body, weekNum: 0 });
  }

  // ④ Weekly thereafter
  const lastOverdueDays = cadence.overdueIntervals.length > 0 ? Math.max(...cadence.overdueIntervals) : 0;
  const weeklyBase = new Date(effectiveDue.getTime() + lastOverdueDays * 86_400_000);
  for (let w = 1; w <= cadence.weeklyCount; w++) {
    const sendAt = new Date(weeklyBase.getTime() + w * 7 * 86_400_000);
    const type   = `weekly_${w}`;
    const { subject, body } = await resolveSubjectBody(
      type, w, seq, invoiceNumber, amount, loadNumber, clientName, dueDate, debtorName,
    );
    specs.push({ sequenceNumber: seq++, reminderType: type, intervalDays: lastOverdueDays + w * 7, scheduledSendAt: sendAt, subject, body, weekNum: w });
  }

  return specs;
}

// ─── Schedule reminders into DB ───────────────────────────────────────────────

async function scheduleReminders(
  followUpId: number,
  cadence: CadenceConfig,
  invoiceNumber: string,
  amount: string,
  loadNumber: string | null | undefined,
  clientName: string,
  dueDate: Date | null,
  debtorName?: string,
): Promise<void> {
  const specs = await buildReminderSchedule(cadence, invoiceNumber, amount, loadNumber, clientName, dueDate, debtorName);
  if (specs.length === 0) return;

  for (const s of specs) {
    const status      = s.reminderType === "immediate" ? "sent" : "scheduled";
    const actualSendAt = s.reminderType === "immediate" ? new Date() : null;
    await db.insert(brokerFollowUpReminders).values({
      followUpId,
      sequenceNumber: s.sequenceNumber,
      reminderType:   s.reminderType,
      intervalDays:   s.intervalDays ?? null,
      scheduledSendAt: s.scheduledSendAt,
      actualSendAt:    actualSendAt ?? undefined,
      status,
      subject: s.subject,
      body:    s.body,
    });
  }
}

// ─── Auto-stop: check & cancel pending reminders ──────────────────────────────

/**
 * Checks if the invoice for a given follow-up has reached a terminal state.
 * If so, cancels all pending/scheduled reminders and logs to the event ledger.
 *
 * @returns The stop reason string if stopped, null if cadence should continue.
 */
export async function checkAndStopCadence(
  followUpId: number,
  invoiceId: number,
): Promise<string | null> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return null;

  let stopReason: string | null = null;

  // 1. Invoice paid or settled
  if (inv.status === "paid" || inv.status === "settled") {
    stopReason = "invoice_paid";
  }

  // 2. Final settlement factoring stage
  if (!stopReason && inv.factoringStage === "final_settlement") {
    stopReason = "invoice_settled";
  }

  // 3. Open exception raised against this invoice
  if (!stopReason) {
    const [exc] = await db
      .select({ id: exceptions.id })
      .from(exceptions)
      .where(
        and(
          eq(exceptions.entityType, "invoice"),
          eq(exceptions.entityId, invoiceId),
          eq(exceptions.status, "open"),
        ),
      )
      .limit(1);
    if (exc) stopReason = "exception_raised";
  }

  // 4. Fully-applied cash (payment line exists for this invoice)
  if (!stopReason) {
    const [line] = await db
      .select({ id: paymentApplicationLines.id })
      .from(paymentApplicationLines)
      .where(eq(paymentApplicationLines.invoiceId, invoiceId))
      .limit(1);
    if (line) stopReason = "cash_applied";
  }

  if (!stopReason) return null;

  // Cancel all pending/scheduled reminders for this follow-up
  await db
    .update(brokerFollowUpReminders)
    .set({
      status:     "canceled",
      stopReason,
      updatedAt:  new Date(),
    })
    .where(
      and(
        eq(brokerFollowUpReminders.followUpId, followUpId),
        inArray(brokerFollowUpReminders.status, ["scheduled", "paused"]),
      ),
    );

  // Log to event ledger
  try {
    await db.insert(eventLedger).values({
      entityType:  "invoice",
      entityId:    invoiceId,
      eventType:   "broker_followup_auto_stopped",
      actorType:   "system",
      actorId:     "system",
      payloadJson: { followUpId, stopReason, invoiceStatus: inv.status, factoringStage: inv.factoringStage },
    });
  } catch (_) { /* best-effort */ }

  return stopReason;
}

/**
 * Agent-initiated suppress: cancels all pending reminders for a follow-up
 * and logs the agent who suppressed it.
 */
export async function suppressCadence(followUpId: number, invoiceId: number, actorId: string): Promise<void> {
  await db
    .update(brokerFollowUpReminders)
    .set({ status: "canceled", stopReason: "agent_suppressed", updatedAt: new Date() })
    .where(
      and(
        eq(brokerFollowUpReminders.followUpId, followUpId),
        inArray(brokerFollowUpReminders.status, ["scheduled", "paused"]),
      ),
    );

  // Pause the parent follow-up cadence too
  const [bfu] = await db.select({ cadenceConfig: brokerFollowUps.cadenceConfig }).from(brokerFollowUps).where(eq(brokerFollowUps.id, followUpId));
  const cfg = { ...(bfu?.cadenceConfig ?? {}), paused: true } as CadenceConfig;
  await db.update(brokerFollowUps).set({ cadenceConfig: cfg, updatedAt: new Date() }).where(eq(brokerFollowUps.id, followUpId));

  try {
    await db.insert(eventLedger).values({
      entityType:  "invoice",
      entityId:    invoiceId,
      eventType:   "broker_followup_suppressed",
      actorType:   "user",
      actorId,
      payloadJson: { followUpId, stopReason: "agent_suppressed" },
    });
  } catch (_) { /* best-effort */ }
}

// ─── Core trigger function ────────────────────────────────────────────────────

/**
 * Creates a broker follow-up + full reminder sequence for the given invoice.
 * Idempotent for `auto` triggers.
 *
 * @returns the broker_follow_up id, or null if the invoice was not found
 */
export async function triggerBrokerFollowUp(
  invoiceId: number,
  actorId: string,
  triggerStatus = "funded",
  triggerType: "auto" | "manual" = "auto",
  cadenceOverride?: Partial<CadenceConfig>,
): Promise<number | null> {
  if (triggerType === "auto") {
    await brokerCollectionsService.enrolBatch([invoiceId]);
    return null;
  }
  // 1. Load invoice
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return null;

  // 3. Resolve cadence + carrier/debtor names
  const cadence: CadenceConfig = { ...DEFAULT_CADENCE, ...cadenceOverride };

  let clientName  = "Carrier";
  let brokerName: string | undefined;
  let brokerEmail: string | null = null;

  if (inv.clientId) {
    const [cl] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, inv.clientId));
    if (cl) clientName = cl.name;
  }
  if (inv.brokerId) {
    const [b] = await db.select({ email: brokers.email, name: brokers.name }).from(brokers).where(eq(brokers.id, inv.brokerId));
    if (b?.email) brokerEmail = b.email;
    if (b?.name) brokerName = b.name;
  } else if (inv.debtorId) {
    const [d] = await db.select({ email: debtors.email, name: debtors.name }).from(debtors).where(eq(debtors.id, inv.debtorId));
    if (d?.email) brokerEmail = d.email;
    if (d?.name)  brokerName = d.name;
  }

  // 4. Build immediate email content (template-aware)
  const { subject: immediateSubject, body: immediateBody } = await resolveSubjectBody(
    "immediate", 0, 1, inv.invoiceNumber, inv.amount, inv.loadNumber, clientName, inv.dueDate ?? null, brokerName,
  );

  // 5. Insert broker_follow_up parent record
  const [record] = await db
    .insert(brokerFollowUps)
    .values({
      invoiceId,
      clientId:      inv.clientId ?? null,
      brokerId:      inv.brokerId ?? null,
      triggerType,
      triggerStatus,
      subject:       immediateSubject,
      body:          immediateBody,
      status:        "pending",
      sentBy:        actorId,
      cadenceConfig: cadence,
    })
    .returning({ id: brokerFollowUps.id });

  // 6. Build reminder sequence (async, template-aware)
  await scheduleReminders(
    record.id,
    cadence,
    inv.invoiceNumber,
    inv.amount,
    inv.loadNumber,
    clientName,
    inv.dueDate ?? null,
    brokerName,
  );

  // 7. Write to event_ledger
  await db.insert(eventLedger).values({
    entityType: "invoice",
    entityId:   invoiceId,
    eventType:  "broker_followup_triggered",
    actorType:  "user",
    actorId,
    payloadJson: {
      followUpId:    record.id,
      triggerStatus,
      triggerType,
      subject:       immediateSubject,
      clientName,
      invoiceNumber: inv.invoiceNumber,
      cadence,
    },
  });

  // 8. Send immediate email (best-effort) and capture the provider acceptance ID
  if (cadence.sendImmediately && brokerEmail) {
    try {
      const { success, messageId } = await sendEmailTracked({
          to:      brokerEmail,
        emailLog: { entityType: "followup", entityId: record.id, templateName: "broker_followup", followupImmediate: true },
        subject: immediateSubject,
        text: configuredPaymentBody(immediateBody),
        html: textToEmailBody(configuredPaymentBody(immediateBody)),
      });
      if (success) {
        await db.update(brokerFollowUps)
          .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
          .where(eq(brokerFollowUps.id, record.id));
        // Update the immediate reminder row with delivery tracking
        const [immReminder] = await db
          .select({ id: brokerFollowUpReminders.id })
          .from(brokerFollowUpReminders)
          .where(and(
            eq(brokerFollowUpReminders.followUpId, record.id),
            eq(brokerFollowUpReminders.reminderType, "immediate"),
          ))
          .limit(1);
        if (immReminder) {
          await db.update(brokerFollowUpReminders)
            .set({
              status:            "sent",
              actualSendAt:      new Date(),
              providerMessageId: messageId ?? null,
              deliveryStatus:    messageId ? "pending" : "sent",
              updatedAt:         new Date(),
            })
            .where(eq(brokerFollowUpReminders.id, immReminder.id));
        }
      }
    } catch (_) { /* email failure is non-fatal */ }
  }

  return record.id;
}

// ─── Background scheduler: process due reminders ─────────────────────────────

let _schedulerHandle: NodeJS.Timeout | null = null;

/**
 * Check for scheduled reminders whose `scheduledSendAt` has passed and send them.
 * Skips reminders belonging to paused follow-ups.
 * Runs checkAndStopCadence() before sending each reminder.
 */
export async function processScheduledReminders() {
  const result = await brokerCollectionsService.tick();
  return { ...result, stopped: 0, statusCode: collectionRunHttpStatus(result) };
}

// Retained only as historical implementation context; never scheduled or exported.
async function processLegacyScheduledReminders(): Promise<{ sent: number; skipped: number; stopped: number }> {
  const now = new Date();
  let sent    = 0;
  let skipped = 0;
  let stopped = 0;

  // Recover reminders left in-flight if a worker stopped after claiming one.
  await db.update(brokerFollowUpReminders)
    .set({ status: "scheduled", updatedAt: now })
    .where(and(
      eq(brokerFollowUpReminders.status, "sending"),
      lte(brokerFollowUpReminders.updatedAt, new Date(now.getTime() - 30 * 60 * 1000)),
    ));

  // Fetch due reminders with their parent follow-up data
  const dueReminders = await db
    .select({
      reminderId:     brokerFollowUpReminders.id,
      followUpId:     brokerFollowUpReminders.followUpId,
      reminderType:   brokerFollowUpReminders.reminderType,
      sequenceNumber: brokerFollowUpReminders.sequenceNumber,
      subject:        brokerFollowUpReminders.subject,
      body:           brokerFollowUpReminders.body,
      invoiceId:      brokerFollowUps.invoiceId,
      cadenceConfig:  brokerFollowUps.cadenceConfig,
      brokerId:        invoices.brokerId,
      debtorId:       invoices.debtorId,
      invoiceNumber:  invoices.invoiceNumber,
    })
    .from(brokerFollowUpReminders)
    .innerJoin(brokerFollowUps, eq(brokerFollowUpReminders.followUpId, brokerFollowUps.id))
    .innerJoin(invoices,        eq(brokerFollowUps.invoiceId, invoices.id))
    .where(
      and(
        eq(brokerFollowUpReminders.status, "scheduled"),
        lte(brokerFollowUpReminders.scheduledSendAt, now),
      ),
    );

  for (const r of dueReminders) {
    // ── Auto-stop check ────────────────────────────────────────────────────────
    const stopReason = await checkAndStopCadence(r.followUpId, r.invoiceId);
    if (stopReason) {
      console.log(`[reminderScheduler] auto-stopped follow-up ${r.followUpId} — reason: ${stopReason}`);
      stopped++;
      continue;
    }

    // ── Cadence globally paused check ──────────────────────────────────────────
    const cfg = r.cadenceConfig as CadenceConfig | null;
    if (cfg?.paused) {
      await db.update(brokerFollowUpReminders)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(brokerFollowUpReminders.id, r.reminderId));
      skipped++;
      continue;
    }

    // Claim atomically so overlapping scheduler/admin runs cannot send twice.
    const [claimed] = await db.update(brokerFollowUpReminders)
      .set({ status: "sending", updatedAt: new Date() })
      .where(and(
        eq(brokerFollowUpReminders.id, r.reminderId),
        eq(brokerFollowUpReminders.status, "scheduled"),
      ))
      .returning({ id: brokerFollowUpReminders.id });
    if (!claimed) continue;

    // ── Try to send email ──────────────────────────────────────────────────────
    let emailSent  = false;
    let messageId: string | undefined;
    if (r.brokerId || r.debtorId) {
      try {
        const [contact] = r.brokerId
          ? await db.select({ email: brokers.email }).from(brokers).where(eq(brokers.id, r.brokerId))
          : await db.select({ email: debtors.email }).from(debtors).where(eq(debtors.id, r.debtorId!));

        if (contact?.email) {
          const result = await sendEmailTracked({
            to:      contact.email,
            emailLog: { entityType: "followup", entityId: r.followUpId, templateName: "broker_followup",
              followupReminderId: r.reminderId, sentByUserId: null },
            subject: r.subject,
            text: configuredPaymentBody(r.body),
            html: textToEmailBody(configuredPaymentBody(r.body)),
          });
          emailSent = result.success;
          messageId  = result.messageId;
        }
      } catch (_) { /* email failure is non-fatal */ }
    }

    await db.update(brokerFollowUpReminders)
      .set({
        status:            "sent",
        actualSendAt:      new Date(),
        providerMessageId: messageId ?? null,
        deliveryStatus:    messageId ? "pending" : "sent",
        updatedAt:         new Date(),
      })
      .where(and(
        eq(brokerFollowUpReminders.id, r.reminderId),
        eq(brokerFollowUpReminders.status, "sending"),
      ));

    // Write audit event
    try {
      await db.insert(eventLedger).values({
        entityType:  "invoice",
        entityId:    r.invoiceId,
        eventType:   "broker_followup_reminder_sent",
        actorType:   "system",
        actorId:     "system",
        payloadJson: {
          followUpId:     r.followUpId,
          reminderId:     r.reminderId,
          reminderType:   r.reminderType,
          sequenceNumber: r.sequenceNumber,
          emailSent,
          invoiceNumber:  r.invoiceNumber,
        },
      });
    } catch (_) { /* best-effort */ }

    sent++;
  }

  return { sent, skipped, stopped };
}

/**
 * Start the background reminder scheduler.
 * Runs every 15 minutes; safe to call multiple times (idempotent).
 */
export function startReminderScheduler(intervalMs = 15 * 60 * 1000): void {
  if (_schedulerHandle) return;
  processScheduledReminders().catch(e =>
    console.warn("[reminderScheduler] initial run error:", e?.message),
  );
  _schedulerHandle = setInterval(() => {
    processScheduledReminders().catch(e =>
      console.warn("[reminderScheduler] tick error:", e?.message),
    );
  }, intervalMs);
  console.log(`[reminderScheduler] started — interval ${intervalMs / 60000}min`);
}

export function stopReminderScheduler(): void {
  if (_schedulerHandle) {
    clearInterval(_schedulerHandle);
    _schedulerHandle = null;
  }
}
