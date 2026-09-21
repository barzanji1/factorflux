---
name: API authorization coverage
description: Durable rules for keeping centralized API permission routing complete without breaking provider callbacks.
---

Every concrete staff API prefix must resolve to a module permission, including legacy aliases and write-only subresources. Treat unmatched authenticated fallback as a coverage failure, not a safe default. External provider callbacks are the exception: exempt only the exact callback path and authenticate it cryptographically against the unmodified request bytes.

**Why:** Representative endpoint tests missed alternate prefixes that allowed authenticated users to bypass module permissions. Applying staff-session permission middleware to a provider webhook fixed the bypass but broke the integration; restoring public access without signature verification would allow forged state updates.

**How to apply:** When adding or changing routes, inventory all concrete API paths against the permission map. Test low-permission accounts against aliases and write methods. For signed webhooks, preserve raw bytes only for the exact path, fail closed when verification is unavailable, and test valid, unsigned, and tampered payloads.