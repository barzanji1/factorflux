---
name: Broker Portal access policy
description: User-approved matching and scope boundaries for broker self-registration.
---

Broker self-registration grants invoice access only after verifying an email that uniquely matches an existing broker's contact email. A company name is not authorization. Unmatched and ambiguous email matches must not expose invoices.

**Why:** The user explicitly chose “Verified existing contact email” when asked how registrations should link to an existing broker.

**How to apply:** Preserve verified-contact matching when extending onboarding. Supporting additional broker contacts or manual matching requires an explicit authorized workflow, not a looser company-name lookup.

Keep the broker-facing portal separate from internal staff access. Phase 1 deliberately excluded new internal dashboard views. The user has now authorized Phase 2 internal management, while explicitly requiring that Phase 1 pages/routes and the existing email confirmation flow remain unchanged.

**Why:** The user separated broker-facing delivery from internal management into two phases and repeated the isolation boundary in the Phase 2 requirements.

**How to apply:** Do not turn broker credentials into staff sessions. Extend internal management separately; preserve the existing broker-facing routes and first-response-wins behavior rather than rewriting them for staff reporting.
