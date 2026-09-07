---
name: Chargeback extensions
description: The interaction between automatic 90-day chargebacks and agent-selected extension dates.
---

An invoice with an active chargeback extension must not be automatically charged at the original 90-day threshold while its extension date is still in the future.

**Why:** Charging at 90 days regardless of the override would make the agent extension action ineffective.

**How to apply:** Aging and scheduler changes may charge an extended invoice only when its current extension/chargeback date has arrived.