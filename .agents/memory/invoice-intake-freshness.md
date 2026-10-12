---
name: Invoice intake freshness
description: User-required fresh broker and carrier data in Create Invoice.
---

Create Invoice must invalidate and refetch broker branches/details on modal open or broker selection, including reselection of the same broker. Apply the same freshness requirement to carrier data and related form choices.

**Why:** The user explicitly requires current entity data rather than stale state from an earlier fetch.

**How to apply:** Preserve this behavior for manual selections and prefilled intake. Pending or failed refreshes must not silently present cached details as current. Keep this requirement scoped to invoice intake rather than changing cache policy throughout the app.
