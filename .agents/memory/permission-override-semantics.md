---
name: Permission override semantics
description: How explicit user permission rows interact with role defaults.
---

An account with any explicit permission rows uses those rows as its complete permission set; role defaults are used only when it has no explicit rows.

**Why:** Seeding one new module permission for a default-only account can unintentionally remove access to every other default module.

**How to apply:** Register new modules in the role defaults. If existing accounts truly need explicit grants, migrate their full effective permission set rather than inserting only the new permission.

Permission revalidation before navigation must not become a loading gate for every successful background refresh.

**Why:** Gating the whole route during periodic/focus refreshes would unmount working forms and discard agents' unsent email drafts, even when their access has not changed.

**How to apply:** Wait for fresh permissions before deciding access on navigation; preserve mounted forms during ordinary background checks. Report refresh failures as retryable checks, not as evidence that access was denied.