# Carrier client API and funding tracker

This adds backend APIs and controls in the existing staff submission/invoice
detail views. It does **not** add a mobile app, replace the existing carrier
portal, change broker APIs, or initiate/reverse financial transactions.

## Release

Apply `migrations/0060_client_api_funding.sql` to the database used by the app
before starting this version. It has been applied to the workspace-configured
database. A separately configured production database also needs this migration.
Use the configured PostgreSQL connection, not an unrelated managed database.

The migration is additive. Existing submission receipt dates are backfilled from
their original intake date. Legacy editable submission statuses are **not**
treated as proof of review or payment.

Requirements: existing PostgreSQL, S3, email configuration, `SESSION_SECRET`, and
Firebase Admin service account. JWT signing uses a domain-separated derived key;
it does not introduce another secret or reuse staff/broker sessions as tokens.

## Authentication

All bodies are JSON unless multipart is specified. Responses and verification
pages use `Cache-Control: no-store`. Errors have `{message, details?}`.

`POST /api/client/register`

```json
{
  "companyName": "Example Carrier",
  "contactName": "Contact Name",
  "email": "contact@example.com",
  "phone": "5550101111",
  "mcNumber": "123456",
  "password": "a-strong-password-of-at-least-12-characters"
}
```

Maximum three registration attempts per rolling hour per IP, enforced in the
database across instances. Passwords are bcrypt-hashed; the maximum is 72 UTF-8
bytes. Email comparisons ignore case and surrounding whitespace.

Registration returns `201` with `id`, `status`, `message`,
`verificationEmailSent` and, if needed, an explicit `deliveryNotice`. Registration
does not grant a token before email ownership has been verified.

- `POST /api/client/request-verification`: `{email,password}` requests another
  email, invalidating older challenges.
- `GET /api/client/verify-email?token=...`: confirmation form, without activating
  anything merely because an email scanner opens the URL.
- `POST /api/client/verify-email`: `{token}` consumes a one-hour, single-use
  challenge. Only a SHA-256 token hash is stored.

A uniquely matching existing carrier contact email activates automatically.
A claimed MC number or company name does not grant another carrier's access.
Unmatched/ambiguous emails remain pending after verification and require admin
approval. An employee's legacy portal approval cannot authorize an unmatched
account for the new client API.

An admin can use existing portal account approval, or
`POST /api/internal/client-accounts/:id/approve` with `{carrierId}` to explicitly
link a pending account to an existing carrier. Approval does not waive email
verification, create a carrier, or displace another active carrier account.
The same admin endpoint can authorize an existing active legacy portal account
for the new client API. It cannot reassign an existing carrier binding. New
verification never silently changes a legacy account's carrier or disables its
existing portal access.

`POST /api/client/login` with `{email,password}` returns:

```json
{
  "token": "<JWT>",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "client": { "id": 123, "carrierId": 456, "companyName": "Example Carrier" }
}
```

Every remaining `/api/client/*` endpoint requires
`Authorization: Bearer <JWT>`. Staff/broker cookies do not authorize it. Tokens
are issuer/audience/algorithm/expiry checked. Suspension, password changes and
carrier reassignment invalidate existing access. Ownership checks include both
the portal account and its current carrier, including after reassignment.

## Dashboard and submissions

- `GET /api/client/dashboard`: `activeSubmissionCount`, `pendingReviewCount`,
  `fundedThisWeekCount`, `fundedThisWeekTotal`, `weekStartsAt`.
  Weeks start Monday UTC. Money is a decimal string, using verified net payouts,
  not invoice face value. Rejected submissions are excluded from active counts.
- `GET /api/client/submissions?page=1`: `{items,total,page,pageSize:15}`.
- `GET /api/client/submissions/:id`: submission fields plus `progress`, including
  `fundingStatus`, three timestamps, verified funding flag and net funded amount.
  Internal change reasons/history and staff identifiers are not exposed.
- `POST /api/client/submissions`: JSON or multipart with invoice intake fields:
  `invoiceNumber`, `loadNumber`, `loadType`, `brokerId`, `branchId`, `code`,
  `lumper` (`yes`/`no`), `driverName`, `bankAccountId`, positive two-decimal
  `amount`, `paymentType` (`ACH`/`wire`), optional `instructionsSubject`,
  `instructionsDetails`, and `acknowledgements:[{code,reason?}]`.
  It returns `201` with the new received submission and automatic receipt time.

Intake reuses existing preflight and near-duplicate checks, the shared duplicate
advisory lock, active broker/branch validation, and own-carrier active bank
validation. A `409` preflight response includes `details.alerts`; acknowledgements
cannot override blocking alerts. This creates a portal submission, not a funded
invoice. Existing invoice creation and financial processing remain unchanged.

Lookup endpoints for constructing valid intake:
- `GET /api/client/submission-options`: supported `loadTypes` and own-carrier
  bank IDs/labels only, never decrypted bank credentials.
- `GET /api/client/brokers?search=...&page=1`: active broker IDs/names, 15 per page.
- `GET /api/client/brokers/:id/branches?page=1`: active branches, 15 per page.

## Documents

Multipart requests use repeated `documents` files and `documentTypes` as a JSON
array, one type per file: `rate_confirmation`, `bol`, `lumper_receipt`, `other`.
`acknowledgements`, when multipart, is also a JSON array string.

- `POST /api/client/submissions/:id/documents`: append documents to an owned,
  not-yet-funded submission; same compression/S3 handling as creation.
- `GET /api/client/submissions/:id/documents?page=1`: paginated safe metadata,
  including original/compressed sizes.
- `GET /api/client/submissions/:id/documents/:documentId/download`: own-document
  `{url,expiresIn:3600}` signed download link. Storage keys are never listed.

Limits: six files, 20 MB each, 40 MB combined, PDF/JPEG/PNG/TIFF/HEIC with
matching file signatures. Up to two multipart requests run per process; excess
capacity returns `429` with `Retry-After`. Intake/upload requests are limited to
ten per minute per authenticated account. HEIC requires the existing decoder.

Only compressed upload bytes are persisted. Durable upload intents are created
before S3 writes and consumed atomically with document rows; failed/abandoned
objects are retried for cleanup. Cleanup checks committed references and cannot
delete an object being committed. Expired uploads cannot commit document rows.

## Client-visible notes

- `GET /api/client/submissions/:id/notes?page=1`
- `POST /api/client/submissions/:id/notes` with `{message}` (1–2,000 characters)

The new thread is explicitly client-visible. Existing private `EntityNotes`
and legacy internal notes are **not** exposed or repurposed.

Staff detail panels use:
- `GET /api/internal/submissions/:id/funding-progress`
- `GET /api/internal/invoices/:id/funding-progress`
- `GET/POST /api/internal/submissions/:id/notes`

These require normal staff authentication and existing module/resource
permissions. Invoice readers without portal-submission permission can read the
tracker but cannot change it or fetch the client-visible notes thread.

## Funding controls

`PUT /api/internal/submissions/:id/step`:

```json
{ "fundingStatus": "under_review", "expectedStatus": "received" }
```

Forward steps are sequential. Reverting requires a reason of at least five
characters. Every actual change records actor, timestamp, old/new step and reason.
Concurrent/stale edits return `409`; updates, audit and push queue are atomic.

“Mark Funded” is available only after an unambiguous existing invoice and its
payout show completed funding: invoice funding time, payout paid time, staff
payer, and an advanced/completed payout state. Matching uses carrier reference
and load identity, never the internal invoice number as a carrier reference.
The tracker cannot pay money, change payout rows, or reverse a payment.
Reconfirming after a tracker correction does not announce a second payment.

## Push

- `POST /api/client/push-token`: `{token,platform:"ios"|"android"|"web"}`.
- `DELETE /api/client/push-token`: `{token}`; call before clearing credentials
  on logout so a shared device can subsequently register to another account.

At most ten active devices per account. Active tokens cannot be stolen by a
different account. Registration returns `deliveryEnabled` as well as
`registered`; missing production Firebase configuration returns `503`.

Review, funding and new staff replies queue durable FCM messages. The worker
checks current account/carrier/device ownership, uses expiring leases, retries
transient failures up to five times and disables invalid device tokens. Clients
can deduplicate at-least-once delivery using `data.eventId`. Preview never sends
real push notifications or verification emails; email non-delivery is explicit.

## Verification

- `npm run check`
- `node --import tsx --test server/services/clientApi.integration.test.ts`
  Uses rolled-back fictional records, injected email sender and mocked FCM.
  Exercises the actual compression/S3 upload path and removes its test objects.
- `npm run build`
- `PRODUCTION_BROWSER_SCRIPT=scripts/verify-client-funding-ui.mjs node --import tsx scripts/verify-production-performance.ts`
  Serves compiled production frontend assets while proxying to the normal running
  application. Uses real staff sign-in, isolated fictional records and real
  pointer events; cleans up afterward without sending emails, payments or push.

Live delivery to a physical registered FCM device is not covered by mocked
delivery tests.
