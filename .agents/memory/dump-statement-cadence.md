---
name: Dump statement cadence and delivery safety
description: Invoice-funded milestone semantics versus broker-wide email consolidation.
---

Dump statements follow each invoice's funded-date milestones, not a broker-wide
clock measured from the last email. When any milestone is due, the statement
includes all the broker's currently open dump-load invoices, including younger
ones. Consolidate triggers in the same scheduled run into one broker email.
Staggered invoice funding dates can therefore produce statements less than ten
days apart without changing the configured ten-day interval.

**Why:** The user requested a cadence from each invoice's funded_at while showing
all open dump invoices for that broker. A broker-wide cooldown would silently
skip some invoice milestones.

**How to apply:** Preserve invoice-relative eligibility when changing cadence,
consolidation, or retry behavior; never replace it with last broker email + interval.

Missed intervals produce one current statement, not a burst of historical emails.
Uncertain provider acceptance blocks another send until acceptance is reconciled;
definite rejections can retry only after current balances and contacts are checked.

**Why:** An aging statement is a financial communication; an outage or lost
provider response must not cause duplicate or obsolete payment demands.

**How to apply:** Keep catch-up and delivery-recovery changes consistent with
these rules, and require verified acceptance before resolving uncertain delivery.
