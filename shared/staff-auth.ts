import { z } from "zod";

export const normalizeStaffEmail = (email: string) => email.trim().toLowerCase();
export const staffEmailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
export const staffLoginSchema = z.object({
  username: staffEmailSchema,
  // Password bytes must remain untouched, including spaces and capitalization.
  password: z.string().min(1, "Password is required"),
});
