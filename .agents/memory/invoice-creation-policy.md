---
name: Invoice creation policy
description: Invoice amount, lumper receipt, and selected-reviewer hold requirements.
---

Rate is the invoice amount. Lumper Total is a separate optional charge and must not be added to Rate automatically. Lumper=Yes requires an uploaded Lumper Receipt; No or blank does not.

**Why:** The user explicitly removed the duplicate Invoice Amount field and requested conditional receipt enforcement.

**How to apply:** Keep form validation and server validation aligned, including OCR-prefilled creation.

Creation holds require one of the requested reasons and one or more explicitly selected reviewer targets. Notify only the resolved selected recipients, deduplicated across groups and individuals. Never guess when a named staff account is missing or ambiguous.

**Why:** The user replaced the general manager-review hold with selected-person routing and bell notifications.

**How to apply:** Keep the selected targets and resolved recipients in the hold audit, and preserve the normal document-readiness flow on manager release.
