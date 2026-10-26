---
name: FMCSA run integrity
description: Safety rules for scheduled and manual FMCSA authority-check runs.
---

If no configured FMCSA key exists, create one skipped run record and do not write per-entity check snapshots. Treat the encrypted database key and environment fallback as equivalent valid configuration.

**Why:** Per-entity missing-key snapshots created tens of thousands of misleading authority records, and overlapping or resumed workers can duplicate snapshots and alerts.

**How to apply:** Bound request concurrency, count only transport/API failures toward the outage circuit breaker, and cancel in-flight work at the threshold. Enforce one active run with a renewable heartbeat plus an ownership token. Fence every entity, alert, and final-status write against the current lease so a resumed stale worker cannot write after takeover.

The Agent Dashboard must show one MC Check summary per run, not individual failed-check alerts. Keep per-entity failures in Run History instead.

**Why:** The user explicitly asked to remove repetitive timeout alerts; thousands of failures from one upstream outage do not provide useful dashboard actions.

**How to apply:** Use run-level counts and link directly to Run History. Preserve authority-check and run audit records rather than deleting the underlying evidence when clearing dashboard noise.