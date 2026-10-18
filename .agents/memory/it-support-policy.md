---
name: IT Support policy
description: Software-only support scope, designated-handler authority, and independent notification semantics.
---

IT Support is the single staff support queue for bugs, product ideas, and questions. Do not restore a separate Tickets menu or workflow. It must remain available to all staff regardless of operational module permissions.

**Why:** The user explicitly clarified that Tickets and IT Support are the same feature and must be consolidated without losing data.

**How to apply:** Preserve historical data when consolidating. The sole IT recipient is fixed to the owner's existing account; no staff selector or reassignment API. Do not promote general roles to grant triage authority.

IT Support alerts are independent from the general notification bell. The designated contact counts incoming requests; other staff count updates on their own submissions. Never combine those counts.

**Why:** The user requires role-separated alerts and acknowledgement of only the current person's opened request. General “mark all read” must not silently erase IT Support updates.

**How to apply:** Keep request ownership immutable. Every submission alerts the fixed IT recipient, including their own submissions. Suppress unchanged-status alerts. Only the fixed contact can delete resolved requests, with confirmation and cleanup of all linked responses and alerts.
