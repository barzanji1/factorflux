---
name: Pilot fixture isolation
description: User constraints for synthetic pilot broker and chargeback records.
---

Pilot brokers deliberately borrow MC numbers from real directory brokers. Do not modify the real brokers whose MCs are borrowed.

**Why:** The user requested separate clean, risky and inactive test brokers, explicitly prohibiting changes to the real directory entries.

**How to apply:** Create broker fixtures through the broker API, tag them as pilot, and scope subsequent synthetic changes to verified fixture IDs/names, never MC number alone. Chargeback fixtures must not introduce alerts against real carriers without explicit permission.
