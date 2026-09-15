---
name: Publish-safe trigram indexes
description: Limitation of publish-time schema diff reconstruction for complex PostgreSQL trigram expression indexes.
---

Avoid deeply nested concatenation expressions with `gin_trgm_ops` in development schemas that must be propagated through the automatic Publish diff.

**Why:** PostgreSQL stores a valid but heavily parenthesized `pg_indexes.indexdef`; the Publish diff reconstruction can truncate the expression before the operator class, producing invalid SQL near `gin_trgm_ops`.

**How to apply:** Prefer publish-safe simple-column indexes or another schema representation. Before publishing, recompute the development-to-production diff and confirm every generated GIN statement is syntactically complete. Production changes must still use Publish.