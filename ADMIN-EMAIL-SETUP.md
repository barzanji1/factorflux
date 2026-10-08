# Email setup

Resend is the only outbound email transport. System notifications, client emails,
follow-up messages, release letters, receipts, and installer scripts all use
`server/resendTransport.js`. Do not call a provider directly elsewhere.

## Sender identity

- `EMAIL_FROM=notifications@truckingprosfinancial.com`
- `EMAIL_REPLY_TO=dosh@truckingprosfinancial.com`

Both settings are validated centrally. Templates and callers cannot override
From or Reply-To. The client composer reads the server's settings.

## Provider connection

Use the existing connected Resend integration. Its key must authorize the verified
`truckingprosfinancial.com` domain. Do not put credentials in source or scripts.
A send-only key cannot list domains; that restriction does not prove it is invalid.

## Delivery and failures

The wrapper returns a Resend acceptance ID, not proof of inbox delivery. Failures
are explicit; there is no alternative transport or log-only success.
Attachments and inline logo content IDs are forwarded to Resend.
Client-email drafts retain their durable idempotency keys, log the actor/content
before sending, and preserve unresolved delivery states for safe reconciliation.

Follow-up reminders store new acceptance IDs in `provider_message_id`.
Apply `migrations/0029_provider_message_id.sql` before running against a new database.
Existing historical tracking data is retained. Delivery/bounce event ingestion
requires a separately configured, verified Resend webhook; no webhook is added here.
