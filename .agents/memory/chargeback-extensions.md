---
name: Chargeback extensions
description: The interaction between automatic 90-day chargebacks and agent-selected extension dates.
---

An invoice with an active chargeback extension must not be automatically charged at the original 90-day threshold while its extension date is still in the future.

**Why:** Charging at 90 days regardless of the override would make the agent extension action ineffective.

**How to apply:** Aging and scheduler changes may charge an extended invoice only when its current extension/chargeback date has arrived.

Warning delivery is separate from applying a chargeback: changing the warning threshold must not change the contractual 90-day chargeback timing or override an extension. Keep the follow-up actionable even when email delivery fails; uncertain delivery must be reconciled against provider acceptance, not blindly resent.

**Why:** An overdue-payment warning is a financial demand. Duplicate demands or a falsely successful send can mislead both the broker and the assigned agent.

**How to apply:** Preserve the per-invoice delivery claim and assigned task across failures. Reconcile accepted sends into the timeline once, and reject retries that quote an outdated balance.