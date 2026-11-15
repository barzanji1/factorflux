# Database backup and restore

The production scheduler (03:00 UTC) and admin-only `POST /api/admin/backup`
use the same **javascript-sql-v1** exporter. No native PostgreSQL client is
required to create a backup. The source uses the app's configured external Neon
connection, converted to a direct connection instead of the transaction pooler.

The exporter uses a dedicated read-only, repeatable-read transaction and a
bounded server cursor per table. It streams SQL through gzip into a private
temporary file, then uploads to the existing S3 backup prefix. Upload, retention
(last 30 backups), advisory locking, and Resend failure alerts are unchanged.
Failure prevents upload and retention cleanup. Temporary files are removed.
The shared export timeout is 1,800,000 ms (30 minutes), including for CLI,
scheduled, and manual admin backups. Individual statements retain their
separate 60-second limit.
Fetches start at 250 rows and grow only for narrow data, targeting 256 KiB
with a maximum of 1,000 rows. Server-quoted values are grouped into INSERTs of
at most 100 rows or 64 KiB (a single larger row remains intact). This avoids
repeating column lists and asynchronous gzip writes for every row. The readable
stream has a 64 KiB byte-based buffer; it never accumulates a whole dump.
JIT is disabled only in the export transaction to avoid compiling one-pass
quoting expressions. Sequence states are read together in one query.
Progress is logged at table-data start, every 10 completed tables, and the last
table: completed/total tables, exported row count, and elapsed milliseconds only.
Each table also logs start/completion and a 10-second heartbeat with an ordinal,
operation, row count, fetch timings and output byte counts, so slow fetches can
be distinguished from slow output/compression. No table names, SQL, row contents,
or connection details are logged.

Supported: ordinary and unlogged tables, column types/defaults/collations,
enums, serial and identity sequences (including their current state), functions,
constraints, indexes, and user triggers (including enabled/disabled state).
Extensions are recreated at their installed version.

This is not a general replacement for every pg_dump feature. Views,
materialized views, partitioning/inheritance, foreign tables, RLS, custom
base/domain/range/composite types, large objects, custom aggregates, event
triggers, generated columns, replication publications/subscriptions, and
extensions with configuration-table data cause `SQL_EXPORT_UNSUPPORTED`.
Do not remove those guards without implementing and restore-testing the
corresponding feature. Ownership and grants are intentionally omitted: objects
are owned by the restoring connection. PostgreSQL role definitions/passwords
are not exported. Application user rows remain part of the confidential backup.

## Restore

Use an **empty, isolated database**. Never restore over the running application.
The restoring role must be able to create the required schemas/extensions.
Install the extension versions named in the backup first if necessary.

```sh
gzip -dc backup.sql.gz | psql -X --set ON_ERROR_STOP=1 --dbname "$RESTORE_DATABASE_URL"
```

SQL definitions/data are restored inside one transaction. Reapply any separately
managed role grants afterward. SQL files contain confidential app data and must
not be logged, added to Git, or shared as review artifacts.

## Verification

Bounded read-only performance probes (no backup uploaded, no row contents logged):

```sh
npx tsx scripts/profile-sql-export.ts
npx tsx scripts/profile-sql-export.ts --stream
```

The first probes two batches in each of the first ten tables with JIT on/off.
The second streams the export through gzip to a discard sink, counts queries
and chunks, and aborts after 150 seconds. Both use only a read-only transaction.

```sh
npx tsx --test server/services/sqlBackup.test.ts
```

This uses a disposable local PostgreSQL cluster and synthetic fixtures. The
export itself runs with PATH empty to prove that it does not use pg_dump.

For a read-only export of the configured app database followed by a restore into
the disposable local cluster (prints only aggregate counts):

```sh
SQL_BACKUP_VERIFY_APP=1 npx tsx --test server/services/sqlBackup.test.ts
```

Publishing is user-initiated. After publishing, authenticate as an admin on the
published app and POST `/api/admin/backup`. A successful response is HTTP 201
with `status: "completed"`, bucket, key, bytes, and retention deletion count.
HTTP 500 is failure, not success; HTTP 409 means another backup holds the lock.
