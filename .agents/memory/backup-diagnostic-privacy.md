---
name: Backup diagnostic privacy
description: Preserve actionable backup failures without exposing PostgreSQL or provider error contents.
---

Backup logs may include bounded, explicitly redacted pg_dump stderr, plus binary presence/version and a credential-free TCP reachability result. Replace passwords and connection strings with `[REDACTED]`; do not persist raw stderr, SQL/data sections, or provider responses. Failure emails retain fixed categories and descriptions rather than stderr.

**Why:** Production nightly exports were failing, but suppressing every error detail made the cause unknowable. The user subsequently explicitly requested redacted stderr, binary/version evidence and a TCP check to expose the actual runtime error without exposing credentials.

**How to apply:** Collect extra evidence only on failure, bound probe timeouts, and never pass database credentials to the version or TCP probes. Test redaction with synthetic sensitive output and fake executables/local sockets, not real exports.
