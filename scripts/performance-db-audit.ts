import fs from "node:fs";
import { pool } from "../server/db";

try {
  const { rows: indexes } = await pool.query(
    "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
  );
  const { rows: statistics } = await pool.query(
    "SELECT relname, n_live_tup, seq_scan, idx_scan FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname",
  );
  const probes = [
    ["invoice-list", "SELECT id FROM public.invoices ORDER BY created_at DESC, id DESC LIMIT 15", []],
    ["employee-tasks", "SELECT id FROM public.tasks WHERE assigned_to=$1 ORDER BY due_date,id LIMIT 15", ["__performance_probe__"]],
    ["expense-list", "SELECT id FROM public.expenses WHERE submitted_by=$1 ORDER BY expense_date DESC,created_at DESC LIMIT 15", ["__performance_probe__"]],
    ["client-list", "SELECT id FROM public.clients ORDER BY name LIMIT 15", []],
    ["broker-list", "SELECT id FROM public.brokers ORDER BY name LIMIT 15", []],
  ] as const;
  const plans = [];
  for (const [name, query, params] of probes) {
    const result = await pool.query(`EXPLAIN (FORMAT JSON) ${query}`, [...params]);
    plans.push({ name, plan: result.rows[0]["QUERY PLAN"][0].Plan });
  }
  fs.mkdirSync("generated-artifacts/performance", { recursive: true });
  fs.writeFileSync("generated-artifacts/performance/database-audit.json", JSON.stringify({ indexes, statistics, plans }, null, 2));
  console.log(JSON.stringify({ indexes: indexes.length, tables: statistics.length, plans: plans.map(({ name, plan }) => ({ name, node: plan["Node Type"], cost: plan["Total Cost"] })) }));
} finally {
  await pool.end();
}
