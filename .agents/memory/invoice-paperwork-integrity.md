---
name: Invoice paperwork integrity
description: Cross-system consistency rule for invoice records and S3 paperwork uploads.
---

Invoice intake must commit the invoice, lifecycle history, ledger event, and document rows in one database transaction. Every uploaded S3 key must be tracked, and failed compensation deletes must enter a durable retry queue rather than being silently ignored.

**Why:** Database transactions cannot roll back S3 writes. Independent inserts or best-effort deletion can leave submitted invoices with missing documents or untracked S3 objects after a partial failure.

**How to apply:** Use this rule for any invoice flow that creates, replaces, or removes paperwork across PostgreSQL and S3. Validate every file and relationship before upload, keep relational writes atomic, and persist failed S3 cleanup for bounded retries.