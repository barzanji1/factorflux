import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import pg from "pg";
import { BACKUP_TIMEOUT_MS, dumpDatabaseSql, identifier, literal } from "./sqlBackup";

const exec = promisify(execFile);
test("SQL identifiers and values are escaped without changing content", () => {
  assert.equal(BACKUP_TIMEOUT_MS, 1_800_000);
  assert.equal(identifier('a"b'), '"a""b"');
  assert.equal(literal("a'b"), "'a''b'");
});

test("native-free backup restores schema, data, sequences and triggers into an empty database", {timeout:180_000}, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(),"tpf-sql-restore-"));
  const data = path.join(directory,"data");
  const socket = path.join(directory,"socket");
  let started = false;
  const env = {PATH:process.env.PATH,LANG:"C",LC_ALL:"C"};
  const admin = new pg.Client({host:socket,port:5432,database:"postgres",user:"backup_fixture"});
  let source: pg.Client | undefined, restored: pg.Client | undefined;
  try {
    await mkdir(socket);
    await exec("initdb",["-D",data,"--username=backup_fixture","--auth=trust","--encoding=UTF8","--no-locale"],{env});
    await exec("pg_ctl",["-D",data,"-l",path.join(directory,"postgres.log"),"-o",`-k ${socket} -h '' -p 5432 -F`,"-w","start"],{env});
    started = true;
    await admin.connect();
    await admin.query("CREATE DATABASE backup_source");
    await admin.query("CREATE DATABASE backup_restored");
    source = new pg.Client({host:socket,port:5432,database:"backup_source",user:"backup_fixture"});
    restored = new pg.Client({host:socket,port:5432,database:"backup_restored",user:"backup_fixture"});
    await source.connect();
    await source.query(`
      CREATE SCHEMA business;
      CREATE TYPE public.kind AS ENUM ('plain','quote''d');
      CREATE TABLE public.parents (id serial PRIMARY KEY, name text NOT NULL UNIQUE);
      CREATE TABLE business."odd table" (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        parent_id integer REFERENCES public.parents(id),
        label text, kind public.kind, items text[], payload jsonb, bytes bytea,
        precise numeric(30,12), at timestamptz, missing text, special float8,
        CHECK (precise>0)
      );
      CREATE INDEX label_idx ON business."odd table" (lower(label));
      CREATE TABLE public.trigger_log (label text);
      CREATE FUNCTION public.log_label() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO public.trigger_log VALUES(NEW.label); RETURN NEW; END $$;
      CREATE TRIGGER logged AFTER INSERT ON business."odd table" FOR EACH ROW EXECUTE FUNCTION public.log_label();
      INSERT INTO public.parents(name) VALUES ('parent');
      INSERT INTO business."odd table"(parent_id,label,kind,items,payload,bytes,precise,at,special)
        VALUES (1,E'quote'' and \\\\ and\\nnewline','quote''d',ARRAY['one',NULL,'quote''d'],
          '{"x": [1, null, "hello"]}',decode('00ff0180','hex'),123456789012345678.123456789012,
          '2026-11-05 12:34:56.123456+00','Infinity');
      ALTER TABLE business."odd table" DISABLE TRIGGER logged;
      CREATE TABLE public.cursor_fixture (id integer, value text);
      INSERT INTO public.cursor_fixture SELECT n, repeat('fixture',20) FROM generate_series(1,601) n;
      CREATE TABLE public.empty_columns ();
      INSERT INTO public.empty_columns DEFAULT VALUES;
      INSERT INTO public.empty_columns DEFAULT VALUES;
    `);
    // Twelve tables exercise the 10-table checkpoint and final partial group.
    for (let n=0; n<7; n++) await source.query(`CREATE TABLE public.progress_${n} (id integer)`);
    const progress = t.mock.method(console, "info", () => {});
    const destination = path.join(directory,"backup.sql.gz");
    const connection = `postgresql://backup_fixture@localhost/backup_source?host=${encodeURIComponent(socket)}`;
    // No native client is used by this path, even with PATH deliberately empty.
    const oldPath = process.env.PATH;
    const query = pg.Client.prototype.query;
    const queries = t.mock.method(pg.Client.prototype, "query", query);
    try {
      process.env.PATH = "/nonexistent";
      await dumpDatabaseSql(destination,connection);
    } finally { process.env.PATH = oldPath; }
    const commands = queries.mock.calls.map(call => call.arguments[0]).filter((sql): sql is string => typeof sql === "string");
    assert.ok(commands.includes("SET LOCAL jit = off"));
    assert.ok(commands.some(sql => /^FETCH FORWARD 1000 FROM/.test(sql)));
    assert.equal(commands.filter(sql => /^SELECT .*last_value::text/.test(sql)).length,1);
    queries.mock.restore();
    const checkpoints = progress.mock.calls.filter(call => call.arguments[0] === "[backup] SQL export progress");
    const tableProgress = progress.mock.calls.filter(call => call.arguments[0] === "[backup] SQL table progress");
    assert.deepEqual(checkpoints.map(call => call.arguments[1]?.tablesCompleted), [0,10,12]);
    assert.equal(checkpoints.at(-1)?.arguments[1]?.rowsExported,606);
    assert.equal(tableProgress.length,24);
    for (const call of tableProgress) {
      assert.deepEqual(Object.keys(call.arguments[1]).sort(), [
        "event","tableOrdinal","tablesTotal","tableRows","rowsExported","fetches","fetchMs","maxFetchMs",
        "outputBytes","operation","tableElapsedMs","elapsedMs",
      ].sort());
    }
    for (const call of checkpoints) {
      assert.deepEqual(Object.keys(call.arguments[1]).sort(),
        ["elapsedMs","phase","rowsExported","tablesCompleted","tablesTotal"].sort());
      assert.equal(call.arguments[0], "[backup] SQL export progress");
    }
    progress.mock.restore();
    const sql = gunzipSync(await readFile(destination)).toString();
    assert.match(sql,/javascript-sql-v1/);
    assert.match(sql,/-- TPF SQL backup complete/);
    const restoreFile = path.join(directory,"restore.sql");
    await writeFile(restoreFile,sql,{mode:0o600});
    await exec("psql",["-X","--set","ON_ERROR_STOP=1","--host",socket,"--username","backup_fixture","--dbname","backup_restored","--file",restoreFile],{env,maxBuffer:1024*1024});
    await restored.connect();
    assert.deepEqual((await restored.query("SELECT * FROM public.cursor_fixture ORDER BY id")).rows,
      (await source.query("SELECT * FROM public.cursor_fixture ORDER BY id")).rows);
    assert.equal((await restored.query("SELECT count(*)::int AS n FROM public.empty_columns")).rows[0].n,2);
    const select = `SELECT id::text,parent_id,label,kind::text,items,payload,encode(bytes,'hex') AS bytes,
      precise::text,at::text,missing,special::text FROM business."odd table"`;
    assert.deepEqual((await restored.query(select)).rows,(await source.query(select)).rows);
    assert.deepEqual((await restored.query("SELECT * FROM public.trigger_log")).rows,(await source.query("SELECT * FROM public.trigger_log")).rows);
    assert.equal((await restored.query("INSERT INTO public.parents(name) VALUES ('next') RETURNING id")).rows[0].id,2);
    assert.equal((await restored.query(`INSERT INTO business."odd table"(parent_id,label) VALUES(2,'next') RETURNING id::text`)).rows[0].id,"2");
    assert.equal((await restored.query("SELECT count(*)::int AS count FROM public.trigger_log")).rows[0].count,1);
    await assert.rejects(restored.query(`INSERT INTO business."odd table"(parent_id) VALUES(999)`),{code:"23503"});
    await assert.rejects(restored.query("INSERT INTO public.parents(name) VALUES ('parent')"),{code:"23505"});
    assert.equal((await restored.query("SELECT count(*)::int AS count FROM pg_indexes WHERE indexname='label_idx'")).rows[0].count,1);
    if (process.env.SQL_BACKUP_VERIFY_APP === "1") {
      // Read-only export of the configured app DB, restored ONLY to the
      // disposable local cluster. Never print SQL, records or connection data.
      const configured = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
      if (!configured) throw new Error("App database is not configured");
      const appUrl = new URL(configured);
      if (appUrl.hostname.endsWith(".neon.tech")) appUrl.hostname=appUrl.hostname.replace(/-pooler(?=\.)/,"");
      const appFile=path.join(directory,"app.sql.gz");
      const appStarted=Date.now();
      await dumpDatabaseSql(appFile,appUrl.toString());
      const appExportMs=Date.now()-appStarted;
      await admin.query("CREATE DATABASE app_restored");
      const appSql=gunzipSync(await readFile(appFile));
      const appRestore=path.join(directory,"app-restore.sql");
      await writeFile(appRestore,appSql,{mode:0o600});
      try {
        await exec("psql",["-X","--quiet","--set","ON_ERROR_STOP=1","--host",socket,"--username","backup_fixture",
          "--dbname","app_restored","--file",appRestore],{env,maxBuffer:1024*1024,timeout:90_000});
      } catch { throw new Error("App SQL restore failed; database output omitted for privacy"); }
      const appRestored=new pg.Client({host:socket,port:5432,database:"app_restored",user:"backup_fixture"});
      try {
        await appRestored.connect();
        const tables=await appRestored.query<{schema:string;name:string}>(`SELECT n.nspname AS schema,c.relname AS name
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r'
          AND n.nspname<>'information_schema' AND n.nspname!~'^pg_'`);
        let rows=0;
        for (const table of tables.rows) {
          rows+=Number((await appRestored.query(`SELECT count(*)::text AS n FROM ${identifier(table.schema)}.${identifier(table.name)}`)).rows[0].n);
        }
        console.log(JSON.stringify({verification:"configured-app-readonly-export-local-restore",tables:tables.rows.length,rows,gzipBytes:(await readFile(appFile)).length,exportMs:appExportMs}));
      } finally { await appRestored.end(); }
    }
    // Unsupported schema must be reported as failure, never a partial success.
    await source.query("CREATE VIEW public.not_supported AS SELECT 1 AS n");
    await assert.rejects(dumpDatabaseSql(path.join(directory,"unsupported.gz"),connection),{code:"SQL_EXPORT_UNSUPPORTED"});
    await assert.rejects(dumpDatabaseSql(path.join(directory,"timeout.gz"),connection,1),{code:"SQL_EXPORT_TIMEOUT"});
  } finally {
    await source?.end().catch(()=>{});
    await restored?.end().catch(()=>{});
    await admin.end().catch(()=>{});
    if (started) await exec("pg_ctl",["-D",data,"-m","immediate","-w","stop"],{env}).catch(()=>{});
    await rm(directory,{recursive:true,force:true});
  }
});
