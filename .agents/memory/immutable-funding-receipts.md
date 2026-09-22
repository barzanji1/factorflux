---
name: Immutable funding receipts
description: Transaction, versioning, and storage-integrity rules for funding receipt issuance.
---

Funding receipt issuance is part of the mandatory funding transaction, not a best-effort post-commit effect. Receipt versions are append-only and must be serialized per invoice before allocating the next version or deterministic S3 key.

**Why:** A concurrent version race can make two transactions upload the same S3 key, after which the losing transaction deletes the winning receipt PDF. A failed database transaction can also leave sensitive orphaned PDFs if storage cleanup is not retried.

**How to apply:** Hold a transaction-scoped invoice lock before version allocation, upload and insert before committing funding, compensate only transaction failures, enqueue failed S3 deletions for durable retry, and never delete a PDF because post-commit email or audit delivery failed.