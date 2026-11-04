---
name: Backup diagnostic privacy
description: Preserve actionable backup failures without exposing PostgreSQL or provider error contents.
---

Backup logs and failure emails must use fixed diagnostic categories and descriptions, with the operation stage and safe process-exit metadata. Do not replace this with raw exception, stderr, SQL, connection-string, or provider-response logging.

**Why:** Production nightly exports were failing, but suppressing every error detail made the cause unknowable. The user approved credential-safe diagnostics; raw PostgreSQL errors may include private database identifiers and SQL as well as credentials.

**How to apply:** Classify errors without persisting their raw contents. Test privacy with synthetic sensitive output and fake processes/providers rather than triggering a real database export just to exercise error handling.
