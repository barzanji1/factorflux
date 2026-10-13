---
name: Agent Performance freshness
description: Required freshness and reset scope when employees or report dates change.
---

Switching or revisiting an employee/date context must obtain fresh server data and reset every dependent control, not just the invoice detail dialog.

**Why:** The user reported continued stale employee and calendar views after a detail-only reset. Distinct cache keys alone do not establish freshness when the app keeps queries fresh indefinitely.

**How to apply:** Audit the selector, both dates, rows, details, exports, and warning controls together. Do not display cached output as current during a refresh. Keep this freshness policy scoped to Agent Performance rather than changing caching throughout the app. Late warning saves must not clear a newer draft.
