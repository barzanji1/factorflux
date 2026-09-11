---
name: Direct-message identity
description: Privacy requirement for identifying a unique two-person conversation.
---

Direct-message identities must use an injective canonical encoding of the sorted participant IDs, not delimiter concatenation.

**Why:** User IDs can contain the delimiter, allowing distinct participant pairs to resolve to the same channel and potentially exposing private message history.

**How to apply:** Use an unambiguous structured encoding or normalized participant columns with a composite uniqueness constraint whenever finding or creating a DM.