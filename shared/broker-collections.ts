import { z } from "zod";

export const collectionActionSchema = z.object({
  action: z.enum(["vp_confirmed", "paid", "pause", "resume", "stop", "start_live"]),
  notes: z.string().trim().max(2000).default(""),
  confirmLive: z.boolean().optional(),
}).strict();
export const collectionSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["dry_run", "live"]),
  confirmLive: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && value.mode === "live" && value.confirmLive !== true) {
    ctx.addIssue({ code: "custom", path: ["confirmLive"], message: "Explicitly confirm live broker emails." });
  }
});
export type CollectionSettings = { enabled: boolean; mode: "dry_run" | "live"; updatedAt: string; canManage: boolean };
export type CollectionRow = {
  invoiceId: number; invoiceNumber: string; loadNumber: string | null;
  broker: string | null; carrier: string | null;
  phase: "vp" | "rps" | "paid" | "stopped"; mode: "dry_run" | "live";
  paused: boolean; escalatedPhase: string | null; vpAttempts: number; rpsAttempts: number;
  nextActionAt: string | null; vpConfirmedAt: string | null; paidAt: string | null;
  lastError: string | null; fundedAt: string; canManage: boolean;
};
export type CollectionEvent = {
  id: number; step: string; phase: string; mode: string; outcome: string;
  scheduledAt: string | null; occurredAt: string; recipient: string | null;
  providerMessageId: string | null; error: string | null; details: unknown;
};
export type CollectionQueue = { rows: CollectionRow[]; total: number; page: number; pageSize: number; settings: CollectionSettings };
export type CollectionDetail = { row: CollectionRow; events: CollectionEvent[] };
