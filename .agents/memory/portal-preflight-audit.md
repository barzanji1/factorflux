---
name: Portal preflight audit
description: Why portal invoice submissions use their own acknowledgement and audit records.
---

Portal intake is a submission, not an invoice. Record its preflight acknowledgements and audit snapshot against the submission and portal identity. Do not invent an invoice or internal user solely to satisfy invoice acknowledgement foreign keys.

**Why:** An invoice ID does not exist at portal submission time, and a portal user's numeric identity is not an internal user's ID. Putting either in invoice acknowledgement or invoice audit records misattributes decisions or violates foreign keys.

**How to apply:** When adding preflight rules to portal intake or converting portal submissions to invoices, preserve the original submission review and decide explicitly how it links to any later invoice review.