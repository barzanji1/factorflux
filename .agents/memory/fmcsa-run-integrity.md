---
name: FMCSA run integrity
description: Safety rules for scheduled and manual FMCSA authority-check runs.
---

If no configured FMCSA key exists, create one skipped run record and do not write per-entity check snapshots. Treat the encrypted database key and environment fallback as equivalent valid configuration.

**Why:** Per-entity missing-key snapshots created tens of thousands of misleading authority records, and overlapping or resumed workers can duplicate snapshots and alerts.

**How to apply:** Bound request concurrency, count only transport/API failures toward the outage circuit breaker, and cancel in-flight work at the threshold. Enforce one active run with a renewable heartbeat plus an ownership token. Fence every entity, alert, and final-status write against the current lease so a resumed stale worker cannot write after takeover.

The Agent Dashboard must show one FMCSA Authority status card using only the latest finished run's summary, not historical run or individual failed-check alert rows. Keep detailed failures in Run History instead.

**Why:** The user explicitly asked to remove repetitive timeout alerts; thousands of failures from one upstream outage do not provide useful dashboard actions.

**How to apply:** Link the entire card to MC Check; show green for no failures, yellow for check failures, red for a failed run, and a not-yet-run state. Preserve authority-check and run audit records. “Active” means actual ACTIVE authority, not just a successful API lookup.