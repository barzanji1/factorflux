---
name: Invoice timeline source
description: Source-of-truth and formatting rules for invoice timeline events.
---

Use `event_ledger` as the sole source for the invoice Timeline tab. Do not merge invoice status history, activities, notes, chargeback tables, or other domain records into the timeline response.

**Why:** Mutations commonly maintain domain history and dashboard activity alongside the audit ledger. Merging those sources rendered the same business event multiple times and exposed serialized audit payloads in the UI.

**How to apply:** Every timeline-worthy invoice mutation must write one canonical ledger event. Format its title and description server-side through the event-type map, include optional reasons as prose, and remove equivalent invoice activity writes. Domain history may remain for operational needs but must not be rendered as another timeline event.

Invoice note timeline entries contain only the action, actor, timestamp, and a note reference. Full text belongs exclusively in the Notes section, including for legacy ledger entries that originally stored a body.

**Why:** The user explicitly requested a multi-agent note stack with timeline links, not duplicate note content in the activity history.

**How to apply:** Keep note mutations and ledger events atomic; redact historical body payloads on timeline reads. Preserve legacy notes without inventing authors when no creator was recorded.

The user requested universal entity notes, not separate per-page note systems. The app's existing Audit Log is backed by `activities`; note mutations must write that audit source and the canonical timeline ledger atomically, without merging them into duplicate timeline rows.

**Why:** Notes now span multiple entity types, while existing Audit Log and invoice timeline screens read different sources. Writing only one would silently omit events from the other.

**How to apply:** Keep one notes API and UI across entity pages. Treat chargeback note identity as invoice-backed and preserve the namespace distinction between invoice and chargeback notes even when their numeric IDs match.