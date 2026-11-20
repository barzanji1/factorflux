import type { PoolClient } from "pg";
import { pool } from "../db";

export class ClientApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export async function clientTransaction<T>(work: (tx: PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try { await tx.query("BEGIN"); const result = await work(tx); await tx.query("COMMIT"); return result; }
  catch (error) { await tx.query("ROLLBACK"); throw error; }
  finally { tx.release(); }
}
export const clientPage = (value: unknown) => {
  const n = value === undefined ? 1 : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000) throw new ClientApiError(400, "Invalid page.");
  return { page: n, pageSize: 15, offset: (n - 1) * 15 };
};
export function clientId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new ClientApiError(400, "Invalid identifier.");
  return id;
}
export const iso = (date: Date | string | null): string | null => date ? new Date(date).toISOString() : null;
