// Read-only checks against the application's configured Neon connection.
import { INSIGHT_ENTITIES } from "../shared/page-insights";
import { readPageInsights } from "../server/services/pageInsights";
import { pool } from "../server/db";
import assert from "node:assert/strict";

async function main() {
  let failures = 0;
  for (const entity of INSIGHT_ENTITIES) {
    const start = performance.now();
    try {
      const result = await readPageInsights(entity, { id: "insights-readonly-verifier", role: "admin" }, entity === "vault" ? { clientId: 1 } : {});
      assert.equal(result.series.length, 6);
      assert(result.total >= 0 && result.open >= 0 && Number.isFinite(result.keyMetric.value));
      assert.equal(result.breakdown.reduce((sum, row) => sum + row.value, 0), result.total);
      console.log(JSON.stringify({ entity, total: result.total, durationMs: Math.round(performance.now() - start), ok: true }));
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ entity, ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  if (failures) process.exitCode = 1;
}
main().finally(() => pool.end());
