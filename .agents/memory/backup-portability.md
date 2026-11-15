---
name: Native-free database backups
description: Production backup portability decision and restore-safety boundary.
---

Do not reintroduce PostgreSQL executables compiled in the Replit development
environment into production backups. Use the native-free SQL exporter for the
scheduled and manual admin backup flows.

**Why:** The bundled client's development loader could not start in the
production container. The configured database was PostgreSQL 18 while the
available system clients were older; the package catalog did not provide a
compatible PostgreSQL 18 client. The user explicitly allowed a JavaScript
export instead. A real read-only app export was successfully restored into a
disposable local database before adopting this approach.

**How to apply:** Treat this as an application-specific export, not an unrestricted
pg_dump equivalent. Unsupported schema features must fail visibly rather than
silently omit objects. Whenever adding such features, extend the exporter and
restore tests first. Restores target an empty isolated database as the restoring
owner; role grants/ownership are separately managed. Never include SQL/data in
diagnostic logs or review assets. Production verification still requires the
user to publish before testing the authenticated admin backup endpoint.

When addressing production export timeouts, preserve progress diagnostics and
do not shorten the existing execution budget as a timeout remedy.

**Why:** The user corrected a change that reduced the budget while investigating
production exports exceeding their deadline; that made the problem worse.

**How to apply:** Compare requested durations with the current effective limit
before editing, and retain the credential-safe table progress logging.

Keep exporter writes byte-bounded and group already-quoted rows before gzip;
avoid one asynchronous compression write per record and one remote query per
sequence. Disable JIT only within the read-only export transaction.

**Why:** Profiling the configured database showed substantial cursor round-trip
and per-row streaming overhead. Grouping reduced both elapsed time and CPU
without increasing the timeout or losing restore fidelity. Production timing
can differ substantially from development, so a local speedup is not proof
that nightly production backups have recovered.

**How to apply:** Preserve bounded-memory backpressure, server-side value
quoting, short-fetch exhaustion handling, and ordinal-only fetch/output
heartbeats. Verify schema/data/sequence restoration in an isolated database
and distinguish local measurements from post-publish production evidence.
