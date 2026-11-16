---
name: Permission override semantics
description: How explicit user permission rows interact with role defaults.
---

An account with any explicit permission rows uses those rows as its complete permission set; role defaults are used only when it has no explicit rows.

**Why:** Seeding one new module permission for a default-only account can unintentionally remove access to every other default module.

**How to apply:** Register new modules in the role defaults. If existing accounts truly need explicit grants, migrate their full effective permission set rather than inserting only the new permission.

After initial server authentication and permission verification, client navigation may use the verified permission snapshot while a fresh check runs in parallel. Server-side authorization remains authoritative on every API request.

**Why:** The user approved removing the per-navigation network gate after live measurements found that it delayed even fully cached routes. Blocking periodic/focus checks also discards working forms despite unchanged access.

**How to apply:** Fail closed before the first verified snapshot; never bypass API permissions. Continue background navigation, focus, cross-tab and periodic checks, apply actual revocations, and reject expired sessions. Report transient refresh failures without unmounting working forms or treating failure as a grant. Discard results belonging to a logged-out/replaced session.