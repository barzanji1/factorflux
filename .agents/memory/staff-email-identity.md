---
name: Staff email identity
description: Case-insensitive staff authentication without rewriting legacy account identities or resetting credentials.
---

Treat staff login emails as case-insensitive and ignore surrounding spaces. Canonicalize emails when creating or explicitly editing staff accounts.

**Why:** The user authorized this after a production login lookup rejected an existing active account solely because its stored email used different capitalization.

**How to apply:** Keep validation and lookup aligned. Preserve existing email spelling and password hashes during normalization fixes; do not bulk-rewrite identities or reset passwords as a workaround.

Never resolve normalized email collisions by selecting the first account or merging users automatically.

**Why:** A valid password must authenticate the intended account, not whichever duplicate a query returns. Database uniqueness is also needed to close concurrent-creation races.

**How to apply:** Audit normalized duplicates before adding constraints, reject ambiguity explicitly, and return a duplicate-account error rather than sending credentials for a second identity.
