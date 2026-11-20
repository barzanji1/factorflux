---
name: Atomic broker response recording
description: Why internal Broker Activity uses database-triggered capture instead of an observer.
---

Record the response amount and queue staff alerts atomically with the broker
response, not with a background observer.

**Why:** The user explicitly approved a database trigger to avoid capturing an
amount edited after the response, while preserving the existing Phase 1 portal
and email handlers. They accepted that a failed audit write aborts the response.

**How to apply:** Keep email sending outside the transaction, but do not move
amount capture or alert-job creation into polling. Treat functions/triggers as
explicit external-database migrations before publishing; Publish does not install
them. Label pre-trigger amounts as historical rather than exact action-time
snapshots.
