---
name: Pilot fixture isolation
description: User constraints for synthetic pilot broker and chargeback records.
---

Pilot brokers deliberately borrow MC numbers from real directory brokers. Do not modify the real brokers whose MCs are borrowed.

**Why:** The user requested separate clean, risky and inactive test brokers, explicitly prohibiting changes to the real directory entries.

**How to apply:** Create broker fixtures through the broker API, tag them as pilot, and scope subsequent synthetic changes to verified fixture IDs/names, never MC number alone. Chargeback fixtures must not introduce alerts against real carriers without explicit permission.

Exclude `data_origin='pilot'` from scheduled broker credit scoring and scheduled FMCSA checks only. Keep manual “Run now” and single-entity checks available for pilot brokers.

**Why:** The user explicitly requested automatic-job isolation without changing manual operations.

**How to apply:** Apply eligibility at scheduled sweep selection, keep untagged/NULL-origin real brokers eligible, and never apply a blanket pilot filter inside shared single-entity check functions.
