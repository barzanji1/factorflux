---
name: Carrier onboarding secrets
description: Security rules for owner identity and business bank values in carrier onboarding.
---

Owner SSNs and bank account/routing values must be encrypted on the server and omitted from every client API response, including list and search responses.

**Why:** Returning ciphertext still leaks sensitive stored material, while blank masked fields during editing must not accidentally erase previously saved credentials.

**How to apply:** Treat secret inputs as write-only. Preserve existing encrypted values when edits leave them blank, and never include encrypted columns in serialized client responses.