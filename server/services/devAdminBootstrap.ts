import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/schema";

/**
 * Ensures the configured development admin exists without ever changing an
 * existing account's password, auth type, role, or profile.
 */
export async function ensureDevAdmin(): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;

  const email = process.env.DEV_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.DEV_ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn("[dev-admin] DEV_ADMIN_EMAIL or DEV_ADMIN_PASSWORD is not configured; bootstrap skipped");
    return;
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    console.log("[dev-admin] Configured admin already exists; left unchanged");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = `dev-admin-${crypto.randomUUID()}`;

  const inserted = await db
    .insert(users)
    .values({
      id,
      email,
      password: passwordHash,
      authType: "local",
      firstName: "Development",
      lastName: "Admin",
      role: "admin",
      status: "active",
      verified: true,
      createdBy: "system",
    })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });

  console.log(inserted.length
    ? "[dev-admin] Stable local development admin created"
    : "[dev-admin] Configured admin was created concurrently; left unchanged");
}