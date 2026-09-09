---
name: Bulk invoice uniqueness
description: Business identity and retry rules that prevent duplicate receivables in bulk invoicing.
---

A normalized broker, carrier, ticket number, and load number combination may produce only one bulk receivable across all agents, report periods, batches, and row ordering. Exact-request idempotency is a separate safeguard and must not replace business-level uniqueness.

**Why:** A retried, reordered, differently dated, or cross-agent submission of the same haul ticket would otherwise create a second valid-looking receivable.

**How to apply:** Any future bulk import, correction, or API path must preserve this cross-batch identity rule. Corrections should update or explicitly supersede the existing record rather than create another receivable with the same identity.