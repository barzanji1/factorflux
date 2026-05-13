/**
 * Broker Follow-Up Automation Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Fires automatically when an invoice is funded (collections-ready).
 * Supports a configurable multi-step reminder cadence:
 *   1. Immediate   — sent at funding time
 *   2. Due Date    — sent on the invoice due date
 *   3. Overdue N   — sent N days after the due date (configurable, default 3 & 7)
 *   4. Weekly N    — sent weekly after the last overdue step (configurable count)
 *
 * All reminder instances are stored in `broker_follow_up_reminders` and
 * processed by a background scheduler (startReminderScheduler).
 */

import { db } from "../db";
import {
  brokerFollowUps,
  brokerFollowUpReminders,
  invoices,
  clients,
  debtors,
  eventLedger,
  type CadenceConfig,
} from "../../shared/schema";
import { eq, and, lte, inArray } from "drizzle-orm";
import { storage } from "../storage";
import { sendEmail } from "../emailService";

// ─── Default cadence ──────────────────────────────────────────────────────────

export const DEFAULT_CADENCE: CadenceConfig = {
  sendImmediately: true,
  sendOnDueDate: true,
  overdueIntervals: [3, 7],
  weeklyCount: 4,
  paused: false,
};

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

// ─── Email content builders ───────────────────────────────────────────────────

function buildReminderSubject(
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

function buildReminderBody(
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
    type === "immediate"   ? "The carrier advance has been processed and payment is now due." :
    type === "due_date"    ? "This invoice is due today. Please remit payment immediately." :
    type.includes("overdue") ? `This invoice is now ${type.replace("d_overdue","").replace("_","")} days past due. Immediate payment is required.` :
    `This is reminder #${seqNumber} — this invoice remains unpaid. Please contact us to resolve.`;

  return [
    "Dear Broker / Debtor,",
    "",
    `This is a payment follow-up (${reminderTypeLabel(type)}) from Trucking Pros Financial`,
    `regarding invoice ${invoiceNumber} for carrier ${clientName}.`,
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

function buildReminderSchedule(
  cadence: CadenceConfig,
  invoiceNumber: string,
  amount: string,
  loadNumber: string | null | undefined,
  clientName: string,
  dueDate: Date | null,
): ReminderSpec[] {
  const specs: ReminderSpec[] = [];
  const now = new Date();
  // Fallback: if no due date, assume 30 days from now
  const effectiveDue = dueDate ?? new Date(now.getTime() + 30 * 86_400_000);
  let seq = 1;

  // ① Immediate
  if (cadence.sendImmediately) {
    specs.push({
      sequenceNumber: seq++,
      reminderType: "immediate",
      intervalDays: null,
      scheduledSendAt: now,
      subject: buildReminderSubject("immediate", 0, invoiceNumber, clientName),
      body: buildReminderBody("immediate", 1, 0, invoiceNumber, amount, loadNumber, clientName),
      weekNum: 0,
    });
  }

  // ② Due date
  if (cadence.sendOnDueDate && effectiveDue > now) {
    specs.push({
      sequenceNumber: seq++,
      reminderType: "due_date",
      intervalDays: 0,
      scheduledSendAt: new Date(effectiveDue),
      subject: buildReminderSubject("due_date", 0, invoiceNumber, clientName),
      body: buildReminderBody("due_date", seq - 1, 0, invoiceNumber, amount, loadNumber, clientName),
      weekNum: 0,
    });
  }

  // ③ Overdue intervals
  for (const days of cadence.overdueIntervals) {
    const sendAt = new Date(effectiveDue.getTime() + days * 86_400_000);
    const type = `${days}d_overdue`;
    specs.push({
      sequenceNumber: seq++,
      reminderType: type,
      intervalDays: days,
      scheduledSendAt: sendAt,
      subject: buildReminderSubject(type, 0, invoiceNumber, clientName),
      body: buildReminderBody(type, seq - 1, 0, invoiceNumber, amount, loadNumber, clientName),
      weekNum: 0,
    });
  }

  // ④ Weekly thereafter
  const lastOverdueDays = cadence.overdueIntervals.length > 0
    ? Math.max(...cadence.overdueIntervals)
    : 0;
  const weeklyBase = new Date(effectiveDue.getTime() + lastOverdueDays * 86_400_000);
  for (let w = 1; w <= cadence.weeklyCount; w++) {
    const sendAt = new Date(weeklyBase.getTime() + w * 7 * 86_400_000);
    const type = `weekly_${w}`;
    specs.push({
      sequenceNumber: seq++,
      reminderType: type,
      intervalDays: lastOverdueDays + w * 7,
      scheduledSendAt: sendAt,
      subject: buildReminderSubject(type, w, invoiceNumber, clientName),
      body: buildReminderBody(type, seq - 1, w, invoiceNumber, amount, loadNumber, clientName),
      weekNum: w,
    });
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
): Promise<void> {
  const specs = buildReminderSchedule(cadence, invoiceNumber, amount, loadNumber, clientName, dueDate);
  if (specs.length === 0) return;

  for (const s of specs) {
    // Immediate reminder is already "sent" by the parent trigger flow
    const status = s.reminderType === "immediate" ? "sent" : "scheduled";
    const actualSendAt = s.reminderType === "immediate" ? new Date() : null;
    await db.insert(brokerFollowUpReminders).values({
      followUpId,
      sequenceNumber: s.sequenceNumber,
      reminderType: s.reminderType,
      intervalDays: s.intervalDays ?? null,
      scheduledSendAt: s.scheduledSendAt,
      actualSendAt: actualSendAt ?? undefined,
      status,
      subject: s.subject,
      body: s.body,
    });
  }
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
  // 1. Load invoice
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return null;

  // 2. Idempotency guard for auto triggers
  if (triggerType === "auto") {
    const [existing] = await db
      .select({ id: brokerFollowUps.id })
      .from(brokerFollowUps)
      .where(
        and(
          eq(brokerFollowUps.invoiceId, invoiceId),
          eq(brokerFollowUps.triggerStatus, triggerStatus),
          eq(brokerFollowUps.triggerType, "auto"),
        ),
      )
      .limit(1);
    if (existing) return existing.id;
  }

  // 3. Resolve cadence + carrier name
  const cadence: CadenceConfig = { ...DEFAULT_CADENCE, ...cadenceOverride };

  let clientName = "Carrier";
  if (inv.clientId) {
    const [cl] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, inv.clientId));
    if (cl) clientName = cl.name;
  }

  let debtorEmail: string | null = null;
  if (inv.debtorId) {
    const [d] = await db.select({ email: debtors.email }).from(debtors).where(eq(debtors.id, inv.debtorId));
    if (d?.email) debtorEmail = d.email;
  }

  const immediateSubject = buildReminderSubject("immediate", 0, inv.invoiceNumber, clientName);
  const immediateBody    = buildReminderBody("immediate", 1, 0, inv.invoiceNumber, inv.amount, inv.loadNumber, clientName);

  // 4. Insert broker_follow_up parent record
  const [record] = await db
    .insert(brokerFollowUps)
    .values({
      invoiceId,
      clientId:      inv.clientId ?? null,
      brokerId:      null,
      triggerType,
      triggerStatus,
      subject:       immediateSubject,
      body:          immediateBody,
      status:        "pending",
      sentBy:        actorId,
      cadenceConfig: cadence,
    })
    .returning({ id: brokerFollowUps.id });

  // 5. Build reminder sequence
  await scheduleReminders(
    record.id,
    cadence,
    inv.invoiceNumber,
    inv.amount,
    inv.loadNumber,
    clientName,
    inv.dueDate ?? null,
  );

  // 6. Write to event_ledger
  await db.insert(eventLedger).values({
    entityType: "invoice",
    entityId:   invoiceId,
    eventType:  "broker_followup_triggered",
    actorType:  triggerType === "auto" ? "system" : "user",
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

  // 7. Activity feed
  try {
    await storage.createActivity({
      userId:      actorId,
      type:        "broker_followup_triggered",
      description: `Broker follow-up ${triggerType === "auto" ? "auto-triggered" : "manually triggered"} for invoice ${inv.invoiceNumber} — ${clientName}`,
      entityType:  "invoice",
      entityId:    invoiceId,
    } as any);
  } catch (_) { /* best-effort */ }

  // 8. Send immediate email (best-effort)
  if (cadence.sendImmediately && debtorEmail) {
    try {
      await sendEmail({
        to:      debtorEmail,
        subject: immediateSubject,
        html:    `<pre style="font-family:sans-serif;white-space:pre-wrap">${immediateBody}</pre>`,
      });
      await db.update(brokerFollowUps)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(brokerFollowUps.id, record.id));
    } catch (_) { /* email failure is non-fatal */ }
  }

  return record.id;
}

// ─── Background scheduler: process due reminders ─────────────────────────────

let _schedulerHandle: NodeJS.Timeout | null = null;

/**
 * Check for scheduled reminders whose `scheduledSendAt` has passed and send them.
 * Skips reminders belonging to paused follow-ups.
 */
export async function processScheduledReminders(): Promise<{ sent: number; skipped: number }> {
  const now = new Date();
  let sent = 0;
  let skipped = 0;

  // Fetch due reminders with their parent follow-up data
  const dueReminders = await db
    .select({
      reminderId:    brokerFollowUpReminders.id,
      followUpId:    brokerFollowUpReminders.followUpId,
      reminderType:  brokerFollowUpReminders.reminderType,
      sequenceNumber: brokerFollowUpReminders.sequenceNumber,
      subject:       brokerFollowUpReminders.subject,
      body:          brokerFollowUpReminders.body,
      invoiceId:     brokerFollowUps.invoiceId,
      cadenceConfig: brokerFollowUps.cadenceConfig,
      debtorId:      invoices.debtorId,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(brokerFollowUpReminders)
    .innerJoin(brokerFollowUps,  eq(brokerFollowUpReminders.followUpId, brokerFollowUps.id))
    .innerJoin(invoices,         eq(brokerFollowUps.invoiceId, invoices.id))
    .where(
      and(
        eq(brokerFollowUpReminders.status, "scheduled"),
        lte(brokerFollowUpReminders.scheduledSendAt, now),
      ),
    );

  for (const r of dueReminders) {
    // Skip if cadence is globally paused
    const cfg = r.cadenceConfig as CadenceConfig | null;
    if (cfg?.paused) {
      await db.update(brokerFollowUpReminders)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(brokerFollowUpReminders.id, r.reminderId));
      skipped++;
      continue;
    }

    // Try to send email
    let emailSent = false;
    if (r.debtorId) {
      try {
        const [debtor] = await db
          .select({ email: debtors.email })
          .from(debtors)
          .where(eq(debtors.id, r.debtorId));

        if (debtor?.email) {
          await sendEmail({
            to:      debtor.email,
            subject: r.subject,
            html:    `<pre style="font-family:sans-serif;white-space:pre-wrap">${r.body}</pre>`,
          });
          emailSent = true;
        }
      } catch (_) { /* email failure is non-fatal */ }
    }

    await db.update(brokerFollowUpReminders)
      .set({
        status:       "sent",
        actualSendAt: new Date(),
        updatedAt:    new Date(),
      })
      .where(eq(brokerFollowUpReminders.id, r.reminderId));

    // Write audit event
    try {
      await db.insert(eventLedger).values({
        entityType:  "invoice",
        entityId:    r.invoiceId,
        eventType:   "broker_followup_reminder_sent",
        actorType:   "system",
        actorId:     "system",
        payloadJson: {
          followUpId:    r.followUpId,
          reminderId:    r.reminderId,
          reminderType:  r.reminderType,
          sequenceNumber: r.sequenceNumber,
          emailSent,
          invoiceNumber: r.invoiceNumber,
        },
      });
    } catch (_) { /* best-effort */ }

    sent++;
  }

  return { sent, skipped };
}

/**
 * Start the background reminder scheduler.
 * Runs every 15 minutes; safe to call multiple times (idempotent).
 */
export function startReminderScheduler(intervalMs = 15 * 60 * 1000): void {
  if (_schedulerHandle) return;
  // Run once immediately on startup (catch up on any missed reminders)
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
