import { sql } from "drizzle-orm";
import { db } from "../db";
import { users } from "../../shared/schema";
import { normalizeStaffEmail, staffEmailSchema } from "../../shared/staff-auth";

type Store = Pick<typeof db, "select" | "insert">;
export type NewStaffAgent = {
  id: string; firstName: string; lastName: string; email: string;
  role: string; password: string; createdBy: string;
};
export class StaffEmailConflictError extends Error {}
export function isStaffEmailConflict(error: unknown): boolean {
  if (error instanceof StaffEmailConflictError) return true;
  // Drizzle may wrap the PostgreSQL error in `cause`.
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const item = current as { code?: string; constraint?: string; cause?: unknown };
    if (item.code === "23505" && ["users_normalized_email_unique", "users_email_unique"].includes(item.constraint ?? "")) return true;
    current = item.cause;
  }
  return false;
}
export async function findStaffByEmail(email: string, store: Store = db) {
  const normalized = normalizeStaffEmail(email);
  if (!normalized) return undefined;
  const matches = await store.select().from(users)
    .where(sql`lower(btrim(${users.email})) = ${normalized}`).limit(2);
  // Never let a legacy collision authenticate an arbitrary account.
  if (matches.length > 1) throw new StaffEmailConflictError("Multiple accounts use this email address. Contact your administrator.");
  return matches[0];
}
export async function createStaffAgent(data: NewStaffAgent, store: Store = db) {
  const email = staffEmailSchema.parse(data.email);
  if (await findStaffByEmail(email, store)) throw new StaffEmailConflictError("An account with this email already exists");
  const [row] = await store.insert(users).values({
    ...data, email, role: data.role as "employee" | "manager" | "admin",
    authType: "local", status: "active", verified: true,
  }).returning();
  return row;
}
