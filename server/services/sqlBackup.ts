import pg from "pg";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

export const BACKUP_TIMEOUT_MS = 600_000;

export const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
export const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const qualified = (schema: string, name: string) => `${identifier(schema)}.${identifier(name)}`;
const userSchema = "n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'";
const notExtension = (catalog: string, alias: string) =>
  `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='${catalog}'::regclass AND d.objid=${alias}.oid AND d.deptype='e')`;

// Deliberately restore as the restoring connection's owner, without role grants
// or ownership changes (equivalent to --no-owner --no-privileges). Unsupported
// database features fail closed instead of producing a misleading partial dump.
export class SqlBackupError extends Error {
  sqlState?: string;
  exportStep?: string;
  constructor(public readonly code: "SQL_EXPORT_UNSUPPORTED" | "SQL_EXPORT_FAILED" | "SQL_EXPORT_TIMEOUT") {
    super(code === "SQL_EXPORT_UNSUPPORTED"
      ? "SQL export encountered an unsupported database feature; no backup was uploaded."
      : code === "SQL_EXPORT_TIMEOUT" ? "SQL export exceeded the backup timeout."
        : "SQL export failed; no backup was uploaded.");
    this.name = "SqlBackupError";
  }
}

interface SequenceRow {
  oid: number; schema: string; name: string; type: string;
  start: string; increment: string; min: string; max: string; cache: string; cycle: boolean;
  dependency: string | null; table_schema: string | null; table_name: string | null; column_name: string | null;
}
function sequenceOptions(s: SequenceRow) {
  // Numeric values originate in bigint system catalog columns, never user SQL.
  return `AS ${s.type} INCREMENT BY ${s.increment} MINVALUE ${s.min} MAXVALUE ${s.max} START WITH ${s.start} CACHE ${s.cache} ${s.cycle ? "CYCLE" : "NO CYCLE"}`;
}

export async function* exportDatabaseSql(client: pg.Client): AsyncGenerator<string> {
  const startedAt = Date.now();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let step = "session";
  try {
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
    await client.query("SET LOCAL IntervalStyle = 'postgres'");
    await client.query("SET LOCAL TimeZone = 'UTC'");
    await client.query("SET LOCAL bytea_output = 'hex'");
    await client.query("SET LOCAL extra_float_digits = 3");
    await client.query("SET LOCAL standard_conforming_strings = on");
    // The supported format covers this app's ordinary tables, enums, sequences,
    // functions, constraints, indexes and triggers. Explicitly refuse objects
    // that require a more general restore planner or privileged role handling.
    step = "feature-check";
    const unsupported = await client.query<{ unsupported: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE ${userSchema} AND ${notExtension("pg_class", "c")}
          AND (c.relkind IN ('p','f','v','m') OR c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity)
        UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
          WHERE ${userSchema} AND ${notExtension("pg_type", "t")}
            AND (t.typtype IN ('d','r','m') OR (t.typtype='c' AND EXISTS
              (SELECT 1 FROM pg_class c WHERE c.oid=t.typrelid AND c.relkind='c'))
              OR (t.typtype='b' AND t.typelem=0))
        UNION ALL SELECT 1 FROM pg_inherits
        UNION ALL SELECT 1 FROM pg_largeobject_metadata
        UNION ALL SELECT 1 FROM pg_policy
        UNION ALL SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userSchema}
        UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE ${userSchema} AND ${notExtension("pg_proc", "p")} AND p.prokind NOT IN ('f','p')
        UNION ALL SELECT 1 FROM pg_publication
        UNION ALL SELECT 1 FROM pg_subscription
        UNION ALL SELECT 1 FROM pg_event_trigger
        UNION ALL SELECT 1 FROM pg_attrdef a JOIN pg_class c ON c.oid=a.adrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          JOIN pg_attribute col ON col.attrelid=c.oid AND col.attnum=a.adnum
          WHERE ${userSchema} AND col.attgenerated <> ''
      ) AS unsupported`);
    if (unsupported.rows[0].unsupported) throw new SqlBackupError("SQL_EXPORT_UNSUPPORTED");

    step = "schemas";
    const schemas = await client.query<{ name: string }>(
      `SELECT n.nspname AS name FROM pg_namespace n WHERE ${userSchema} ORDER BY n.nspname`);
    step = "extensions";
    const extensions = await client.query<{ name: string; schema: string; version: string }>(`
      SELECT e.extname AS name,n.nspname AS schema,e.extversion AS version FROM pg_extension e
      JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname <> 'plpgsql' ORDER BY e.extname`);
    // Extensions with their own configuration-table data need special restore
    // handling. Refuse rather than silently discard those rows.
    const extensionData = await client.query<{ unsupported: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE cardinality(extconfig)>0) AS unsupported");
    if (extensionData.rows[0].unsupported) throw new SqlBackupError("SQL_EXPORT_UNSUPPORTED");
    step = "enums";
    const enums = await client.query<{ schema: string; name: string; labels: string[] }>(`
      SELECT n.nspname AS schema,t.typname AS name,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
      WHERE ${userSchema} AND ${notExtension("pg_type", "t")} GROUP BY n.nspname,t.typname ORDER BY n.nspname,t.typname`);
    step = "functions";
    const functions = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE ${userSchema} AND ${notExtension("pg_proc", "p")} ORDER BY p.oid`);
    step = "sequences";
    const sequences = await client.query<SequenceRow>(`
      SELECT c.oid,n.nspname AS schema,c.relname AS name,format_type(s.seqtypid,NULL) AS type,
        s.seqstart::text AS start,s.seqincrement::text AS increment,s.seqmin::text AS min,
        s.seqmax::text AS max,s.seqcache::text AS cache,s.seqcycle AS cycle,d.deptype AS dependency,
        tn.nspname AS table_schema,t.relname AS table_name,a.attname AS column_name
      FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid
        AND d.refclassid='pg_class'::regclass AND d.refobjsubid>0 AND d.deptype IN ('a','i')
      LEFT JOIN pg_class t ON t.oid=d.refobjid LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
      WHERE ${userSchema} AND ${notExtension("pg_class", "c")} ORDER BY c.oid`);
    step = "tables";
    const tables = await client.query<{ oid: number; schema: string; name: string; persistence: string; options: string[] | null }>(`
      SELECT c.oid,n.nspname AS schema,c.relname AS name,c.relpersistence AS persistence,c.reloptions AS options
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE ${userSchema} AND c.relkind='r' AND ${notExtension("pg_class", "c")} ORDER BY c.oid`);
    if (!tables.rows.length) throw new SqlBackupError("SQL_EXPORT_UNSUPPORTED");
    // Keep DDL from changing definitions halfway through the export, while
    // allowing normal reads/writes and login to proceed.
    await client.query(`LOCK TABLE ${tables.rows.map(t => qualified(t.schema, t.name)).join(",")} IN ACCESS SHARE MODE`);
    step = "columns";
    const columns = await client.query<{
      table_oid: number; name: string; type: string; notnull: boolean; identity: string;
      default_expr: string | null; collation_schema: string | null; collation_name: string | null;
    }>(`
      SELECT a.attrelid AS table_oid,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
        a.attnotnull AS notnull,a.attidentity AS identity,pg_get_expr(ad.adbin,ad.adrelid) AS default_expr,
        cn.nspname AS collation_schema,co.collname AS collation_name
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_type ty ON ty.oid=a.atttypid
      LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
      LEFT JOIN pg_collation co ON co.oid=a.attcollation AND a.attcollation<>ty.typcollation
      LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
      WHERE ${userSchema} AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
        AND ${notExtension("pg_class", "c")} ORDER BY a.attrelid,a.attnum`);
    step = "constraints";
    const constraints = await client.query<{ schema: string; table: string; name: string; kind: string; definition: string }>(`
      SELECT n.nspname AS schema,c.relname AS table,con.conname AS name,con.contype AS kind,
        pg_get_constraintdef(con.oid,true) AS definition
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE ${userSchema} AND c.relkind='r' AND con.contype IN ('p','u','c','f','x')
        AND ${notExtension("pg_class", "c")} ORDER BY (con.contype='f'),con.oid`);
    step = "indexes";
    const indexes = await client.query<{ definition: string }>(`
      SELECT pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE ${userSchema} AND ${notExtension("pg_class", "c")}
        AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid=i.indexrelid)
      ORDER BY i.indexrelid`);
    step = "triggers";
    const triggers = await client.query<{ schema: string; table: string; name: string; enabled: string; definition: string }>(`
      SELECT n.nspname AS schema,c.relname AS table,t.tgname AS name,t.tgenabled AS enabled,
        pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE ${userSchema} AND NOT t.tgisinternal AND ${notExtension("pg_trigger", "t")} ORDER BY t.oid`);

    yield "-- Trucking Pros Financial SQL backup · javascript-sql-v1\n";
    yield "-- Restore to an EMPTY database as its owner using: psql -X --set ON_ERROR_STOP=1\n";
    yield "-- Ownership and grants are intentionally not exported.\n";
    yield "BEGIN;\nSET standard_conforming_strings=on;\nSET check_function_bodies=off;\nSET search_path=pg_catalog,public;\nSET row_security=off;\n";
    for (const s of schemas.rows) yield `CREATE SCHEMA IF NOT EXISTS ${identifier(s.name)};\n`;
    for (const e of extensions.rows)
      yield `CREATE EXTENSION IF NOT EXISTS ${identifier(e.name)} WITH SCHEMA ${identifier(e.schema)} VERSION ${literal(e.version)};\n`;
    for (const e of enums.rows)
      yield `CREATE TYPE ${qualified(e.schema,e.name)} AS ENUM (${e.labels.map(literal).join(",")});\n`;
    for (const f of functions.rows) yield `${f.definition};\n`;
    for (const s of sequences.rows.filter(s => s.dependency !== "i"))
      yield `CREATE SEQUENCE ${qualified(s.schema,s.name)} ${sequenceOptions(s)};\n`;
    step = "table-definitions";
    for (const t of tables.rows) {
      const cols = columns.rows.filter(c => c.table_oid === t.oid);
      const definitions = cols.map(c => {
        let definition = `${identifier(c.name)} ${c.type}`;
        if (c.collation_schema && c.collation_name) definition += ` COLLATE ${qualified(c.collation_schema,c.collation_name)}`;
        if (c.identity) {
          const seq = sequences.rows.find(s => s.dependency === "i" && s.table_schema===t.schema && s.table_name===t.name && s.column_name===c.name);
          if (!seq) throw new SqlBackupError("SQL_EXPORT_UNSUPPORTED");
          definition += ` GENERATED ${c.identity==="a" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY (SEQUENCE NAME ${qualified(seq.schema,seq.name)} ${sequenceOptions(seq).replace(/^AS \S+ /,"")})`;
        } else if (c.default_expr) definition += ` DEFAULT ${c.default_expr}`;
        if (c.notnull) definition += " NOT NULL";
        return definition;
      });
      yield `CREATE ${t.persistence==="u" ? "UNLOGGED " : ""}TABLE ${qualified(t.schema,t.name)} (${definitions.join(",\n")})${t.options?.length ? ` WITH (${t.options.join(",")})` : ""};\n`;
    }
    for (const s of sequences.rows.filter(s => s.dependency==="a" && s.table_schema && s.table_name && s.column_name))
      yield `ALTER SEQUENCE ${qualified(s.schema,s.name)} OWNED BY ${qualified(s.table_schema!,s.table_name!)}.${identifier(s.column_name!)};\n`;

    // Quote values on the server, preserving NULL, bytea, arrays, json, decimals,
    // infinities and timestamp precision without JavaScript type conversions.
    // A server cursor bounds memory; gzip pipeline supplies backpressure.
    step = "table-data";
    let tablesCompleted = 0;
    let rowsExported = 0;
    const logProgress = () => console.info("[backup] SQL export progress", {
      phase: "table-data", tablesCompleted, tablesTotal: tables.rows.length,
      rowsExported, elapsedMs: Date.now() - startedAt,
    });
    logProgress();
    for (const t of tables.rows) {
      const cols = columns.rows.filter(c => c.table_oid === t.oid);
      const rowExpr = cols.length
        ? cols.map(c => `quote_nullable(${identifier(c.name)}::text)`).join(` || ',' || `) : "''";
      await client.query(`DECLARE tpf_backup_rows NO SCROLL CURSOR FOR SELECT ${rowExpr} AS values_sql FROM ${qualified(t.schema,t.name)}`);
      try {
        while (true) {
          const batch = await client.query<{ values_sql: string }>("FETCH FORWARD 250 FROM tpf_backup_rows");
          if (!batch.rows.length) break;
          for (const row of batch.rows) {
            rowsExported++;
            yield cols.length
              ? `INSERT INTO ${qualified(t.schema,t.name)} (${cols.map(c=>identifier(c.name)).join(",")}) OVERRIDING SYSTEM VALUE VALUES (${row.values_sql});\n`
              : `INSERT INTO ${qualified(t.schema,t.name)} DEFAULT VALUES;\n`;
          }
        }
      } finally { await client.query("CLOSE tpf_backup_rows"); }
      tablesCompleted++;
      if (tablesCompleted % 10 === 0 || tablesCompleted === tables.rows.length) logProgress();
    }
    step = "sequence-state";
    for (const s of sequences.rows) {
      const state = await client.query<{ value: string; called: boolean }>(
        `SELECT last_value::text AS value,is_called AS called FROM ${qualified(s.schema,s.name)}`);
      yield `SELECT pg_catalog.setval(${literal(qualified(s.schema,s.name))},${literal(state.rows[0].value)},${state.rows[0].called});\n`;
    }
    for (const c of constraints.rows)
      yield `ALTER TABLE ${qualified(c.schema,c.table)} ADD CONSTRAINT ${identifier(c.name)} ${c.definition};\n`;
    for (const i of indexes.rows) yield `${i.definition};\n`;
    for (const t of triggers.rows) {
      yield `${t.definition};\n`;
      const mode = t.enabled==="D" ? "DISABLE" : t.enabled==="R" ? "ENABLE REPLICA" : t.enabled==="A" ? "ENABLE ALWAYS" : "ENABLE";
      yield `ALTER TABLE ${qualified(t.schema,t.table)} ${mode} TRIGGER ${identifier(t.name)};\n`;
    }
    yield "COMMIT;\n-- TPF SQL backup complete\n";
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* disconnected */ }
    if (error instanceof SqlBackupError) throw error;
    // Raw PostgreSQL errors can contain SQL, data and connection details.
    const failure = new SqlBackupError("SQL_EXPORT_FAILED");
    failure.exportStep = step;
    const code = (error as {code?:unknown})?.code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) failure.sqlState = code;
    throw failure;
  }
}

export async function dumpDatabaseSql(destination: string, databaseUrl: string, timeoutMs=BACKUP_TIMEOUT_MS): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis:10_000, application_name:"tpf_sql_backup" });
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= client.end().catch(() => {});
  try {
    await client.connect();
    // Connection establishment has its own bounded timeout. Never end a pg
    // client twice or interrupt it halfway through its startup packet.
    timer = setTimeout(() => {
      controller.abort();
      void close();
    }, timeoutMs);
    await pipeline(Readable.from(exportDatabaseSql(client)), createGzip(),
      createWriteStream(destination,{mode:0o600,flags:"wx"}), {signal:controller.signal});
  } catch (error) {
    if (controller.signal.aborted) throw new SqlBackupError("SQL_EXPORT_TIMEOUT");
    if (error instanceof SqlBackupError) throw error;
    const failure=new SqlBackupError("SQL_EXPORT_FAILED");
    const code=(error as {code?:unknown})?.code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) failure.sqlState=code;
    failure.exportStep="connect";
    throw failure;
  } finally {
    clearTimeout(timer);
    await close();
  }
}
