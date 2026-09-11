import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { calendarEvents, notifications } from "@shared/schema";

let handle: NodeJS.Timeout | null = null;

/** Return occurrences of an event intersecting the requested range. */
export function expandCalendarEvent(event: CalendarEventLike, from: Date, to: Date) {
  const out: Array<CalendarEventLike & { occurrenceStart: Date; occurrenceEnd: Date }> = [];
  const step = event.recurrence === "daily" ? 1 : event.recurrence === "weekly" ? 7 : 0;
  const duration = event.endAt.getTime() - event.startAt.getTime();
  let cursor = new Date(event.startAt);
  if (step && cursor < from) {
    const elapsedDays = Math.floor((from.getTime() - cursor.getTime()) / 86400000);
    cursor = new Date(cursor.getTime() + Math.max(0, Math.floor(elapsedDays / step) - 1) * step * 86400000);
  }
  let monthlyIndex = 0;
  while (cursor <= to && out.length < 1000) {
    if (event.recurrenceEndAt && cursor > event.recurrenceEndAt) break;
    if (cursor >= from || new Date(cursor.getTime() + duration) >= from) {
      out.push({ ...event, occurrenceStart: new Date(cursor), occurrenceEnd: new Date(cursor.getTime() + duration) });
    }
    if (event.recurrence === "none") break;
    if (step) cursor = new Date(cursor.getTime() + step * 86400000);
    else {
      monthlyIndex++;
      const original = event.startAt;
      const targetMonth = original.getMonth() + monthlyIndex;
      const lastDay = new Date(original.getFullYear(), targetMonth + 1, 0).getDate();
      cursor = new Date(original);
      cursor.setFullYear(original.getFullYear(), targetMonth, Math.min(original.getDate(), lastDay));
    }
  }
  return out.filter((e) => e.occurrenceStart <= to && e.occurrenceEnd >= from);
}

type CalendarEventLike = typeof calendarEvents.$inferSelect;

export async function processCalendarNotifications(now = new Date()) {
  const reminderFrom = new Date(now.getTime() + 14 * 60 * 1000);
  const horizon = new Date(now.getTime() + 16 * 60 * 1000);
  const events = await db.select().from(calendarEvents)
    .where(and(lte(calendarEvents.startAt, horizon), sql`(${calendarEvents.recurrence} <> 'none' OR ${calendarEvents.startAt} >= ${new Date(now.getTime() - 2 * 60 * 1000)})`));
  let reminders = 0;
  for (const event of events) {
    if (event.status !== "scheduled") continue;
    const occurrences = expandCalendarEvent(event, reminderFrom, horizon);
    for (const occurrence of occurrences) {
      if (occurrence.occurrenceStart < reminderFrom || occurrence.occurrenceStart > horizon) continue;
      const actionUrl = `/calendar?eventId=${event.id}&occurrence=${encodeURIComponent(occurrence.occurrenceStart.toISOString())}`;
      const recipient = event.assignedTo ?? event.createdBy;
      if (!recipient) continue;
      const [already] = await db.select({ id: notifications.id }).from(notifications)
        .where(and(eq(notifications.userId, recipient), eq(notifications.entityType, "calendar_event"), eq(notifications.actionUrl, actionUrl))).limit(1);
      if (already) continue;
    await db.insert(notifications).values({
      userId: recipient, title: "Upcoming calendar event",
      message: `${event.title} starts in 15 minutes`,
      type: "info", entityType: "calendar_event", entityId: event.id,
      actionUrl, metadata: JSON.stringify({ occurrenceStart: occurrence.occurrenceStart.toISOString() }),
    } as any).onConflictDoNothing();
    reminders++;
    }
  }

  // Digest is intentionally keyed by the event's assigned user and calendar date.
  // The atomic lastDigestDate update makes retries and multiple workers harmless.
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const sourceEvents = await db.select().from(calendarEvents)
    .where(and(lte(calendarEvents.startAt, dayEnd), sql`(${calendarEvents.recurrence} = 'none' OR ${calendarEvents.recurrenceEndAt} IS NULL OR ${calendarEvents.recurrenceEndAt} >= ${dayStart})`));
  const digestEvents = sourceEvents.flatMap((event) =>
    expandCalendarEvent(event, dayStart, dayEnd).map((occurrence) => ({ ...event, id: event.id, occurrenceStart: occurrence.occurrenceStart })));
  const byUser = new Map<string, typeof digestEvents>();
  for (const e of digestEvents) {
    if (e.status === "scheduled") byUser.set(e.assignedTo ?? e.createdBy, [...(byUser.get(e.assignedTo ?? e.createdBy) ?? []), e]);
  }
  let digests = 0;
  // Only emit around 8am; allowing a 10-minute window handles scheduler drift.
  if (now.getHours() === 8 && now.getMinutes() < 10) for (const [userId, rows] of Array.from(byUser.entries())) {
    const ids = rows.map((r) => r.id);
    const claimed = await db.update(calendarEvents).set({ lastDigestDate: dayStart, updatedAt: now })
      .where(and(sql`coalesce(${calendarEvents.assignedTo}, ${calendarEvents.createdBy}) = ${userId}`, sql`(${calendarEvents.lastDigestDate} IS NULL OR ${calendarEvents.lastDigestDate} < ${dayStart})`))
      .returning({ id: calendarEvents.id });
    if (!claimed.length) continue;
    const [already] = await db.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.entityType, "calendar_digest"), eq(notifications.actionUrl, `/calendar?date=${dayStart.toISOString().slice(0, 10)}`))).limit(1);
    if (already) continue;
    await db.insert(notifications).values({
      userId, title: "Today's schedule", message: `${rows.length} calendar event${rows.length === 1 ? "" : "s"} scheduled today`,
      type: "info", entityType: "calendar_digest", entityId: ids[0] ?? 0,
      actionUrl: `/calendar?date=${dayStart.toISOString().slice(0, 10)}`, metadata: JSON.stringify({ eventIds: ids, date: dayStart.toISOString() }),
    } as any).onConflictDoNothing();
    digests++;
  }
  return { reminders, digests };
}

export function startCalendarScheduler(intervalMs = 60_000) {
  if (handle) return;
  processCalendarNotifications().catch((e) => console.warn("[calendarScheduler] initial run error:", e?.message));
  handle = setInterval(() => processCalendarNotifications().catch((e) => console.warn("[calendarScheduler] tick error:", e?.message)), intervalMs);
}

export function stopCalendarScheduler() {
  if (handle) clearInterval(handle);
  handle = null;
}