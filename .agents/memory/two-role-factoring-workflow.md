---
name: Two-role factoring workflow
description: Durable operational boundary and status interpretation for factoring invoices.
---

Agents may create and correct their own invoices, manage documents only before submission or after rejection, and submit for funding. Managers and administrators own review, rejection, funding, collection, and settlement.

**Why:** Actual operations use two roles and two primary actions; exposing internal lifecycle controls to agents created unnecessary complexity and authorization risk.

**How to apply:** Present Draft → Pending Review → Funded → Collected → Settled to users. Keep internal compatibility statuses only as implementation details, and enforce ownership and role boundaries on APIs as well as UI.

Document completion may automatically queue a pending invoice for review, but must never approve it. Keep Override & Approve confined to the review stage rather than introducing a document-pending fast-track.

**Why:** The user explicitly said the approval error for `docs_pending` is correct because review must not be skipped; hiding the unavailable override preserves the existing manager review boundary.

Any agent may flag an invoice for manager review by creating it on hold, with an optional reason. This does not grant agents permission to release held invoices or place existing invoices on hold.

**Why:** The user wants agents to flag uncertain paperwork or amounts during intake, while managers remain responsible for release and review.

**How to apply:** Creation holds notify active managers/admins. Manager release of intake holds uses current document readiness; preserve the existing release behavior for holds placed after approval.