---
name: Safe schema pushes
description: Project-specific caution for applying additive Drizzle schema changes without accepting unrelated destructive diffs.
---

Do not approve a Drizzle push when it proposes truncating existing tables for unrelated ID-column type conversions. Apply reviewed additive DDL explicitly instead, then verify the live development schema.

**Why:** A routine additive schema push proposed changing existing ID column types and truncating a table containing data.

**How to apply:** Review every push prompt. For additive columns, tables, and indexes, abort any destructive prompt and apply only the required additive statements transactionally. For the app’s external Neon target, follow [External Neon verification](external-neon-verification.md); Publish does not migrate that database.