---
name: Funding lifecycle integrity
description: Atomicity and concurrency rules for invoice funding and hold transitions.
---

Funding must create the payout, change the invoice to funded, and record mandatory lifecycle history and ledger events in one database transaction. Fund and Hold must both condition their updates on the expected current status.

**Why:** A transaction alone does not prevent a concurrent Hold request from overwriting a Fund transition. Unconditional status updates can leave an advance-paid payout attached to a held invoice.

**How to apply:** For any competing invoice lifecycle action, use compare-and-set status updates with a required returned row. Roll back funding if the invoice is no longer approved, keep post-commit communications non-blocking, and preserve the one-payout-per-invoice constraint.