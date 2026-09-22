---
name: Carrier chat terminal states
description: Preventing carrier profile message flicker when no portal conversation exists.
---

Treat “carrier has no active portal account” as a terminal, cached chat state rather than a transient polling failure.

**Why:** Re-fetching the expected 404 every five seconds repeatedly transitioned the carrier profile message query and caused the empty/error view to flicker.

**How to apply:** Stop the message query’s refetch interval after a 404, and do not refetch that cached terminal state on mount or reconnect. Keep polling for real conversations, and ensure message fetches consume React Query’s abort signal so stale requests cannot overwrite optimistic state.