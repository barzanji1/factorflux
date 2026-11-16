---
name: Agent Performance freshness
description: Required freshness and reset scope when employees or report dates change.
---

Employee/date contexts must stay isolated and reset every dependent control, not just the invoice detail dialog. Cached revisits within the same context now follow the shared show-first policy: display real cached data immediately and refresh silently after 30 seconds.

**Why:** The user reported stale employee/date controls after a detail-only reset, then explicitly superseded application-wide loading behavior with timestamped caching and silent refreshes.

**How to apply:** Audit the selector, both dates, rows, details, exports, and warning controls together. Never show another employee/date context's data as a placeholder. Do not blank successful cached rows, options, or warnings merely because a background fetch is running. Late warning saves must not clear a newer draft.
