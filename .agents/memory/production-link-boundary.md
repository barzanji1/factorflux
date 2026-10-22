---
name: Production link boundary
description: Outbound staff/client links must be independent of the workspace or request host.
---

Never derive login, welcome-email, installer, or other distributed links from the current request host or workspace development domains. Only use verified published custom domains. Reject development origins in editable outbound-link settings, including legacy repl.co and workspace URLs.

**Why:** An agent account created from Preview received a credentials email linking to the sleeping development workspace and saw a “Run this app” placeholder instead of the login page.

**How to apply:** Verify the current published domain through deployment metadata before changing the canonical link policy. Keep the carrier portal's established domain unchanged. Retain required server-side platform connectors and development tooling; those are not user-facing branding. Obsolete prebuilt distributions must not reintroduce workspace links.
