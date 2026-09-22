---
name: Invoice timeline source
description: Source-of-truth and formatting rules for invoice timeline events.
---

Use `event_ledger` as the sole source for the invoice Timeline tab. Do not merge invoice status history, activities, notes, chargeback tables, or other domain records into the timeline response.

**Why:** Mutations commonly maintain domain history and dashboard activity alongside the audit ledger. Merging those sources rendered the same business event multiple times and exposed serialized audit payloads in the UI.

**How to apply:** Every timeline-worthy invoice mutation must write one canonical ledger event. Format its title and description server-side through the event-type map, include optional reasons as prose, and remove equivalent invoice activity writes. Domain history may remain for operational needs but must not be rendered as another timeline event.