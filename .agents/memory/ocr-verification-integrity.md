---
name: OCR verification integrity
description: Queued completion and nonempty native footer text are not proof of OCR success.
---

Verify OCR provenance and actual document text; never equate a completed extraction job, native fallback, or raw nonempty text with successful OCR.

**Why:** The hybrid pipeline has marked jobs completed after its OCR provider failed, storing native page-label text instead. Typechecking also accepted an OCR package import whose named function was unavailable at runtime; native-only regression tests did not detect that integration failure.

**How to apply:** Exercise the actual job queue and configured provider on scan PDFs. Require an OCR-specific result method and document content, and report provider failures explicitly with unavailable fields rather than successful zero-character results. For dependency/import changes, verify runtime behavior instead of relying on package declarations. Use isolated verification records and remove only those records, leaving originals and business data intact.
