import { z } from "zod";

export const optionalInvoiceBranchSchema = z.preprocess(
  value => value == null || (typeof value === "string" && !value.trim()) ? null : value,
  z.coerce.number().int().positive().nullable().optional(),
);

export const optionalInvoiceBuyoutSchema = z.preprocess(
  value => value === "" ? null : value,
  z.boolean().nullable().optional(),
);

export const optionalLumperSchema = z.preprocess(value => {
  if (value == null || value === "") return null;
  if (value === "yes" || value === "true") return true;
  if (value === "no" || value === "false") return false;
  return value;
}, z.boolean().nullable());

export const invoiceCreationHoldSchema = z.object({
  holdForManagerReview: z.boolean().optional().default(false),
  holdReason: z.string().trim().max(10000).nullable().optional(),
  heldFor: z.array(z.enum(["managers", "mia", "jose", "jess", "alan"])).max(5).default([]),
}).superRefine((value, ctx) => {
  if (!value.holdForManagerReview) return;
  if (!(HOLD_REASONS as readonly string[]).includes(value.holdReason ?? "")) {
    ctx.addIssue({ code: "custom", path: ["holdReason"], message: "Select a reason for hold." });
  }
  if (!value.heldFor.length) ctx.addIssue({ code: "custom", path: ["heldFor"], message: "Select at least one hold recipient." });
});

export const HOLD_REASONS = ["Missing docs", "Missing signature on BOL", "Missing signature on Rate Con"] as const;
export const HOLD_TARGETS = [
  { value: "managers", label: "Managers" },
  { value: "mia", label: "Mia" },
  { value: "jose", label: "Jose" },
  { value: "jess", label: "Jess" },
  { value: "alan", label: "Alan" },
] as const;

export const lumperTotalSchema = z.preprocess(value => value == null || value === "" ? null : value,
  z.union([z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Lumper Total must be a nonnegative dollar amount."),
    z.number().finite().nonnegative().refine(value => Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001)])
    .nullable().transform(value => value == null ? null : Number(value).toFixed(2))
    .refine(value => value == null || Number(value) <= 99999999.99, "Lumper Total is too large."));

export function requireLumperReceipt(lumper: unknown, hasReceipt: boolean) {
  if (optionalLumperSchema.parse(lumper) === true && !hasReceipt) {
    throw Object.assign(new Error("Lumper Receipt is required when Lumper is Yes."), { status: 400 });
  }
}
