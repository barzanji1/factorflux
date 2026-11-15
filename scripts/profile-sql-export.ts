// Bounded read-only probe. Never log SQL, database addresses, or row contents.
import pg from "pg";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { exportDatabaseSql, identifier } from "../server/services/sqlBackup";

async function main() {
  const configured = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!configured) throw new Error("Database is not configured");
  const url = new URL(configured);
  if (url.hostname.endsWith(".neon.tech")) url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
  const client = new pg.Client({
    connectionString: url.toString(), connectionTimeoutMillis: 10_000,
    application_name: "tpf_export_readonly_probe",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await client.connect();
    if (process.argv.includes("--stream")) {
      let queryMs = 0, queries = 0, chunks = 0, bytes = 0, gzipBytes = 0;
      const query = client.query.bind(client);
      client.query = (async (...args: any[]) => {
        const start = performance.now();
        try { return await (query as any)(...args); }
        finally { queryMs += performance.now() - start; queries++; }
      }) as typeof client.query;
      const start = performance.now();
      const cpu = process.cpuUsage();
      const controller = new AbortController();
      timer = setTimeout(() => { controller.abort(); void client.end().catch(()=>{}); }, 150_000);
      async function* measured() {
        for await (const chunk of exportDatabaseSql(client)) {
          chunks++; bytes += Buffer.byteLength(chunk);
          yield chunk;
        }
      }
      try {
        await pipeline(Readable.from(measured()), createGzip(),
          new Writable({write(chunk, _encoding, done) { gzipBytes += chunk.length; done(); }}), {signal:controller.signal});
      } finally {
        const used = process.cpuUsage(cpu);
        console.log(JSON.stringify({probe:"stream",elapsedMs:Math.round(performance.now()-start),
          queryMs:Math.round(queryMs),queries,chunks,bytes,gzipBytes,
          cpuMs:Math.round((used.user+used.system)/1000),aborted:controller.signal.aborted}));
      }
      return;
    }
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const tables = await client.query<{ oid: number; schema: string; name: string; columns: string[] }>(`
      SELECT c.oid,n.nspname AS schema,c.relname AS name,
        array_agg(a.attname::text ORDER BY a.attnum) AS columns
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      WHERE c.relkind='r' AND n.nspname<>'information_schema' AND n.nspname!~'^pg_'
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
      GROUP BY c.oid,n.nspname,c.relname ORDER BY c.oid LIMIT 10`);
    for (const [index, table] of tables.rows.entries()) {
      const expr = table.columns.map(col => `quote_nullable(${identifier(col)}::text)`).join(" || ',' || ");
      const measurements = [];
      for (const jit of ["on", "off"]) {
        await client.query(`SET LOCAL jit = ${jit}`);
        await client.query(`DECLARE probe NO SCROLL CURSOR FOR SELECT ${expr} AS values_sql FROM ${identifier(table.schema)}.${identifier(table.name)}`);
        for (let batch = 0; batch < 2; batch++) {
          const start = performance.now();
          const result = await client.query<{values_sql: string}>("FETCH FORWARD 250 FROM probe");
          const fetchMs = Math.round(performance.now() - start);
          const gzipStart = performance.now();
          const text = result.rows.map(row => row.values_sql).join("\n");
          gzipSync(text);
          measurements.push({jit,batch,rows:result.rowCount,fetchMs,gzipMs:Math.round(performance.now()-gzipStart),bytes:Buffer.byteLength(text)});
          if (!result.rows.length) break;
        }
        await client.query("CLOSE probe");
      }
      console.log(JSON.stringify({tableOrdinal:index+1,columns:table.columns.length,measurements}));
    }
    await client.query("ROLLBACK");
  } finally { clearTimeout(timer); await client.end().catch(()=>{}); }
}
main().catch(() => {
  console.error("Read-only export probe failed; database output omitted for privacy.");
  process.exitCode = 1;
});
