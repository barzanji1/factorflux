export interface TaskAnalyticsRow {
  status: string;
  priority: string;
  type: string;
  dueDate?: string | Date | null;
  createdAt: string | Date | null;
  updatedAt?: string | Date | null;
}
export function taskCalendarDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return date.toISOString().slice(0, 10) === value ? value : null;
  }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
}
/** The task editor stores date-only due dates at UTC midnight; they expire after that calendar day, not the preceding Denver evening. */
export function taskDueDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().endsWith("T00:00:00.000Z") ? date.toISOString().slice(0, 10) : taskCalendarDate(value);
}
export function isTaskOverdue(task: Pick<TaskAnalyticsRow, "status" | "dueDate">, now = new Date()): boolean {
  const due = taskDueDate(task.dueDate);
  return task.status !== "completed" && due !== null && due < taskCalendarDate(now)!;
}
function monday(key: string) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
export function buildTaskStats(tasks: TaskAnalyticsRow[], now = new Date()) {
  const today = taskCalendarDate(now)!;
  const start = new Date(`${monday(today)}T12:00:00Z`);
  const weeks = Array.from({ length: 8 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() - (7 - index) * 7);
    return { week: date.toISOString().slice(0, 10), created: 0, completed: 0 };
  });
  const priorities = [
    { priority: "high", label: "High / urgent", count: 0 },
    { priority: "medium", label: "Medium", count: 0 },
    { priority: "low", label: "Low", count: 0 },
    { priority: "unknown", label: "Other", count: 0 },
  ];
  let completedToday = 0, inProgress = 0, overdue = 0, open = 0, unknownCompletionDate = 0;
  for (const task of tasks) {
    if (task.status !== "completed") {
      open++;
      const priority = task.priority === "urgent" ? "high" : ["high", "medium", "low"].includes(task.priority) ? task.priority : "unknown";
      priorities.find(row => row.priority === priority)!.count++;
    }
    if (task.status === "in_progress") inProgress++;
    if (isTaskOverdue(task, now)) overdue++;
    const created = taskCalendarDate(task.createdAt);
    if (created && new Date(task.createdAt!) <= now) {
      const row = weeks.find(row => row.week === monday(created));
      if (row) row.created++;
    }
    if (task.status === "completed") {
      const updated = taskCalendarDate(task.updatedAt);
      if (!updated) unknownCompletionDate++;
      else if (new Date(task.updatedAt!) <= now) {
        if (updated === today) completedToday++;
        const row = weeks.find(row => row.week === monday(updated));
        if (row) row.completed++;
      }
    }
  }
  return { total: tasks.length, open, inProgress, completedToday, overdue, weeks, priorities: priorities.filter(row => row.priority !== "unknown" || row.count > 0), unknownCompletionDate };
}
