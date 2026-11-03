---
name: Chargeback refund safety
description: User-confirmed evidence boundary for reserve refunds and separate chargeback scheduling versus resolution.
---

Require a verified reserve debit before restoring any reserve for a chargeback refund. A charged/scheduled status alone is not evidence that money was deducted; legacy bookkeeping refunds alone are not evidence that a reserve credit occurred.

**Why:** The automatic chargeback process historically marked invoices charged without debiting reserves. The user explicitly chose “Require verified debit” rather than allowing unverified refunds that manufacture a reserve credit.

**How to apply:** Fail closed when debit evidence is absent. Cap cumulative refunds at both the original chargeback and the unreturned verified debit. Preserve scheduling/extension state separately from financial resolution.

Partial refunds remain open until fully refunded or written off. Short-pay recoveries represent actual additional applied cash, not a manual resolved flag.

**Why:** The requested workflow distinguishes cumulative money movements from status labels; financial reports must reconcile with the payment ledger.

**How to apply:** Keep reserve restoration and its audit records atomic and idempotent. Report notification failures separately from an already committed financial action, so retrying an email cannot issue another credit.
