import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTaskStats, isTaskOverdue, taskCalendarDate, taskDueDate, type TaskAnalyticsRow } from "./task-analytics";
const now = new Date("2026-10-31T18:00:00Z");
const task = (patch: Partial<TaskAnalyticsRow> = {}): TaskAnalyticsRow => ({
  status: "todo", priority: "medium", type: "task", createdAt: now, ...patch,
});
test("empty tasks give zero counts and eight Monday-based weeks", () => {
  const stats = buildTaskStats([], now);
  assert.equal(stats.total, 0);
  assert.equal(stats.weeks.length, 8);
  assert.equal(stats.weeks[0].week, "2026-09-07");
  assert.equal(stats.weeks[7].week, "2026-10-26");
});
test("calendar dates and date-only due dates preserve their different semantics", () => {
  assert.equal(taskCalendarDate("2026-11-01T02:00:00Z"), "2026-10-31");
  assert.equal(taskCalendarDate("2026-10-31"), "2026-10-31");
  assert.equal(taskDueDate("2026-10-31T00:00:00.000Z"), "2026-10-31");
  assert.equal(taskCalendarDate("invalid"), null);
  assert.equal(taskCalendarDate("2026-02-30"), null);
});
test("overdue excludes completed, invalid/missing dates, and the current due day", () => {
  assert.equal(isTaskOverdue(task({ dueDate: "2026-10-30" }), now), true);
  assert.equal(isTaskOverdue(task({ dueDate: "2026-10-31T00:00:00Z" }), now), false);
  assert.equal(isTaskOverdue(task({ dueDate: "2026-11-01" }), now), false);
  assert.equal(isTaskOverdue(task({ dueDate: "bad" }), now), false);
  assert.equal(isTaskOverdue(task(), now), false);
  assert.equal(isTaskOverdue(task({ status: "completed", dueDate: "2026-10-30" }), now), false);
});
test("open includes all unfinished tasks and priorities reconcile including urgent/unknown", () => {
  const stats = buildTaskStats([
    task({ priority: "urgent" }), task({ priority: "high", status: "held" }), task({ status: "in_progress" }),
    task({ priority: "low" }), task({ priority: "unexpected" }), task({ status: "completed" }),
  ], now);
  assert.equal(stats.open, 5);
  assert.equal(stats.inProgress, 1);
  assert.equal(stats.priorities[0].count, 2);
  assert.equal(stats.priorities.reduce((n, row) => n + row.count, 0), stats.open);
});
test("weekly created and completed counts are independent; completion uses updatedAt only", () => {
  const stats = buildTaskStats([
    task({ createdAt: "2026-10-15T18:00:00Z", status: "completed", updatedAt: now }),
    task({ status: "completed" }), task({ status: "completed", updatedAt: "bad" }),
    task({ updatedAt: now }), task({ createdAt: "2026-09-01T18:00:00Z" }),
  ], now);
  assert.equal(stats.completedToday, 1);
  assert.equal(stats.unknownCompletionDate, 2);
  assert.equal(stats.weeks[5].created, 1);
  assert.equal(stats.weeks[7].completed, 1);
  assert.equal(stats.weeks[7].created, 3);
});
test("calendar weeks and today metrics use Denver dates across midnight and daylight-saving changes", () => {
  const boundary = new Date("2026-11-02T04:00:00Z"); // Sunday evening in Denver, not Monday.
  const stats = buildTaskStats([
    task({ createdAt: boundary, status: "completed", updatedAt: boundary }),
    task({ createdAt: "2026-11-03T18:00:00Z", status: "completed", updatedAt: "2026-11-03T18:00:00Z" }),
  ], boundary);
  assert.equal(stats.weeks[7].week, "2026-10-26");
  assert.equal(stats.weeks[7].created, 1);
  assert.equal(stats.weeks[7].completed, 1);
  assert.equal(stats.completedToday, 1);
});
