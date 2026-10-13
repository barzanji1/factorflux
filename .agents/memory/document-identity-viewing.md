---
name: Document identity and viewing
description: Original-byte identity, safe abandoned-upload cleanup, and live browser document verification.
---

Reuse identical pending intake paperwork only within the same uploader's unlinked documents. Preserve identity from the original upload, before compression.

**Why:** Retrying a draft can otherwise leave a second unlinked copy. OCR hashes may describe compressed bytes, which no longer match the original file resubmitted with the invoice. Matching across linked invoices would risk stealing another invoice's paperwork.

**How to apply:** Serialize concurrent pending-identity checks, associate the existing row when submitting the invoice, and verify byte identity plus link/owner scope before cleaning abandoned rows. Never delete all unlinked documents indiscriminately; retain unrelated drafts and older attempts.

Successful S3 GetObject tests and server redirects do not prove cross-origin browser fetches work.

**Why:** This bucket returned valid PDFs with HTTP 200 while the browser's fetch of a redirect failed for missing CORS headers. Normal navigation does not require that fetch permission.

**How to apply:** Test real browser document opening separately from IAM/key/signature checks. Do not broaden IAM or bucket CORS merely to accommodate a view button that can navigate normally.

Use an explicit desktop viewport for live invoice UI tests and check tab activation before looking for document cards.

**Why:** Chromium's small default viewport clips the overflowing tab bar behind the fixed layout, making coordinate-based tab clicks unreliable even when the tab exists.

**How to apply:** Verify the active tab state; keyboard activation is a valid way to enter the paperwork tab. Continue using real pointer input to verify the document View buttons.
