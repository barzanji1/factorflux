import { z } from "zod";

export const broadcastFiltersSchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["new_client", "active", "inactive"]).optional(),
  assignedProcessor: z.string().min(1).max(200).optional(),
}).strict();
export const broadcastDraftSchema = z.object({
  requestId: z.string().uuid(),
  subject: z.string().trim().min(1, "Subject is required").max(200)
    .refine(value => !/[\r\n]/.test(value), "Subject must be a single line"),
  body: z.string().trim().min(1, "Message is required").max(20000),
  templateName: z.string().trim().min(1).max(120).nullable().optional(),
  filters: broadcastFiltersSchema.default({}),
  clientIds: z.array(z.number().int().positive()).min(1).max(10000).optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  scheduleTimeZone: z.string().max(80).refine(value => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid IANA time zone").default("America/Denver"),
}).strict();
export type BroadcastFilters = z.infer<typeof broadcastFiltersSchema>;
export type BroadcastDraftInput = z.infer<typeof broadcastDraftSchema>;
export type BroadcastCounts = { total: number; sendable: number; skipped: number; pending: number; sent: number; failed: number; unconfirmed: number };
export type BroadcastClient = {
  id: number; name: string; email: string | null; status: string; assignedProcessor: string | null;
  canSend: boolean; skipReason: string | null;
};
export type BroadcastSummary = {
  id: string; subject: string; body: string; templateName: string | null; filters: BroadcastFilters;
  clientIds: number[] | null;
  status: "draft" | "scheduled" | "queued" | "sending" | "completed" | "cancelled" | "failed";
  createdBy: string; createdByName: string; createdAt: string; confirmedAt: string | null; completedAt: string | null;
  scheduledAt: string | null; scheduleTimeZone: string; dispatchStartedAt: string | null;
  revision: number; error: string | null;
  counts: BroadcastCounts;
};
export type BroadcastRecipient = {
  id: number; clientId: number | null; clientName: string; email: string | null;
  status: "pending" | "sent" | "skipped" | "failed" | "unconfirmed";
  error: string | null; providerMessageId: string | null; sentAt: string | null;
};
export type BroadcastDetail = { broadcast: BroadcastSummary; recipients: BroadcastRecipient[] };
