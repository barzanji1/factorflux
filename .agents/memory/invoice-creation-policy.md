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

Named hold options may represent a user-confirmed nickname rather than the stored first name. Require explicit identity confirmation before adding an alias; never infer recipients from a name prefix. Aliases must still reject inactive or ambiguous matches.

**Why:** The user confirmed that an unavailable named reviewer was an existing active manager using a different stored first name.

**How to apply:** Preserve confirmed aliases when changing recipient lookup; retain active-account filtering, uniqueness checks, and group/individual deduplication.

Multiple documents of the same type are normal and must not block intake.

**Why:** The user explained that carriers send original plus corrected invoices, multiple rate confirmations, and multiple BOLs for multi-stop loads.

**How to apply:** Preserve every uploaded document and allow multiple files in each paperwork slot. Do not reintroduce a one-document-per-classification restriction or change OCR classification to enforce one.
