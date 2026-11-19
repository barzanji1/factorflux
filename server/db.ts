import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL or NEON_DATABASE_URL must be set.",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool, schema });