---
name: External Neon verification
description: How to avoid checking the wrong database when validating application data.
---

This project’s application data uses its configured external Neon connection. Database callback results may come from a separate managed development database and must not be treated as proof of application state.

**Why:** A managed-database query reported that the configured development admin was absent while the running app’s Neon database contained the account.

**How to apply:** For application-record verification, run a small project script through the existing database module and return only non-sensitive metadata. Never print connection strings, password hashes, or secret values.