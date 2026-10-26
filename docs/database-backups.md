# Database health and backups

- Public `GET /api/health`: tests the app's Neon pool (`SELECT 1`) and
  `HeadBucket` on `factorflux-documents-tpf`. Returns HTTP 200 when both pass,
  or 503 with `status: "error"` when either fails. Results are coalesced/cached
  for ten seconds; dependency errors and credentials are never public.
- Admin-role-only `POST /api/admin/backup`: returns 201 with the uploaded key,
  byte count, and number of old backups deleted, 409 if another backup owns
  the lock, or 500 on failure. Delegated admin-module access is not sufficient.
- CLI: `npm run backup:db` (or `npx tsx scripts/backup-db.ts`). Exit code 1
  means failure; it uses the same runner and alerting as the API.
- The production app schedules backups nightly at **03:00 UTC**. Development
  does not schedule them. The app must be running at the scheduled time; an
  in-process cron cannot run while an autoscaling deployment is idle/stopped.
  This change does not alter hosting or publish the app. An external scheduler
  can instead run the CLI once nightly in an environment with the same secrets.

## Storage and safety

The app's existing `NEON_DATABASE_URL` takes precedence over `DATABASE_URL`.
This is intentional: a separate managed `DATABASE_URL` must not silently back
up a different database. `DATABASE_URL` is supported when Neon is not configured.
The script does not migrate, restore, or modify application tables.

For Neon, the backup runner removes the `-pooler` hostname suffix and connects
directly to the same endpoint/database. Both the backup lock and `pg_dump` use
this direct connection. Neon does not support `pg_dump` through transaction
pooling: dump session settings can otherwise leak into ordinary app requests
and break unqualified table lookups. The app itself retains its pooled connection.

`pg_dump` streams plain SQL through gzip into a private temporary directory.
It uploads only after both the dump process and compression finish successfully:

`s3://factorflux-documents-tpf/backups/db/factorflux-YYYY-MM-DD-HHmmss.sql.gz`

Dates are UTC. Uploads request AES-256 server-side encryption and refuse to
overwrite an existing key. After upload, all listing pages are inspected and
only the newest 30 matching backup filenames are kept. No other documents or
keys are deleted. A cross-process PostgreSQL transaction advisory lock serializes
CLI, API, and scheduled backups. Temporary files are removed even on failure.

Failures attempt an email to `dosh@truckingprosfinancial.com` through the existing
logged, branded Resend wrapper. If that alert also fails, the failure is logged;
no email transport can guarantee delivery during its own outage. Logs intentionally
omit PostgreSQL stderr and credentials.

Required AWS actions are `s3:ListBucket` on the bucket (health and prefix listing),
and `s3:PutObject` / `s3:DeleteObject` on `backups/db/*`. Ordinary documents are
outside backup retention. Backups contain sensitive application data: keep the
bucket private and limit access to the backup prefix.

## PostgreSQL client

Neon currently runs PostgreSQL 18, while the available Replit PostgreSQL toolchain
is older. `npm run build:pg-dump` builds the PostgreSQL **18.6** client from the
official PostgreSQL source distribution, verifies its published SHA-256 checksum,
and places it in `dist/tools/bin/pg_dump`, with its matching libpq in
`dist/tools/lib`. Only the client is built, not a server.
The production build includes this step; generated source files use `/tmp` and
the compiled client is a build artifact, never committed to Git. OpenSSL and
build-tool dependencies are declared in `.replit`.

For local CLI use, run `npm run build:pg-dump` once first. The runner falls back
to system `pg_dump` if the bundled client is absent; an incompatible version
fails explicitly and triggers the same failure alert. A dump is not proof of a
successful restore; periodically test restoration in an isolated database.
