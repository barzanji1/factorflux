import { z } from "zod";

export const optionalLumperSchema = z.preprocess(value => {
  if (value == null || value === "") return null;
  if (value === "yes" || value === "true") return true;
  if (value === "no" || value === "false") return false;
  return value;
}, z.boolean().nullable());

export const invoiceCreationHoldSchema = z.object({
  holdForManagerReview: z.boolean().optional().default(false),
  holdReason: z.string().trim().max(10000).nullable().optional(),
});
