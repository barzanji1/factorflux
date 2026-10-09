---
name: OCR verification integrity
description: Queued completion and nonempty native footer text are not proof of OCR success.
---

Verify OCR provenance and actual document text; never equate a completed extraction job, native fallback, or raw nonempty text with successful OCR.

**Why:** The hybrid pipeline has marked jobs completed after its OCR provider failed, storing native page-label text instead. Typechecking also accepted an OCR package import whose named function was unavailable at runtime; native-only regression tests did not detect that integration failure.

**How to apply:** Exercise the actual job queue and configured provider on scan PDFs. Require an OCR-specific result method and document content, and report provider failures explicitly with unavailable fields rather than successful zero-character results. For dependency/import changes, verify runtime behavior instead of relying on package declarations. Use isolated verification records and remove only those records, leaving originals and business data intact.

## Provider choice and fallback policy

The user selected AWS Textract with existing AWS credentials in `us-east-2`, rather than Claude vision. Do not silently change cloud providers to work around account access failures.

**Why:** This was the user's explicit provider choice. Existing S3 access does not establish Textract subscription/service access; only a real AnalyzeExpense request verifies that. Conversely, a rotated IAM user can successfully run Textract while lacking S3 upload permissions.

**How to apply:** Report AWS account/service errors explicitly and keep OCR results unavailable until access works.

A thrown primary-provider error must fail the job with the original error stored. Do not hide it by running a successful fallback. Tesseract fallback may handle a successful but text-empty cloud response.

**Why:** The user required provider exceptions to end in `failed`, never `completed`; automatic exception-to-fallback success would violate that requirement.

**How to apply:** Preserve exception propagation across provider adapters. Show the latest failed attempt on Documents and as a nonblocking invoice info alert; historical failed attempts must not keep an alert after a successful retry.

## Independent storage verification

Generating a presigned URL is not proof of download authorization. Verify its HTTP response and returned bytes; signing alone happens locally.

**Why:** After credential rotation, OCR can work independently of S3 permissions. If upload fails and the app has no known existing S3 object, there is no existing-object download result to claim.

**How to apply:** Test upload, signed GET, and isolated-object cleanup separately. Report a blocked download test as unverified, not as success or an inferred GetObject denial. Never display signed URLs or credential values.
