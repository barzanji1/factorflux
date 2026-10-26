---
name: Sentry privacy boundary
description: Explicit opt-out controls and conservative event filtering required for error telemetry.
---

Do not send staff/client PII, credentials, financial document contents, or arbitrary free text to Sentry. Preserve code locations and error metadata instead.

**Why:** The user explicitly prohibited PII. Names cannot reliably be removed with an email regex; they may occur in messages, breadcrumbs, context, request data, or captured locals.

**How to apply:** Keep collection disabled at the SDK source and apply the shared allow-list before transmission. Do not relax filtering merely to improve diagnostic detail without revisiting the privacy requirement.

SDK v11 replaced the older `sendDefaultPii` option with granular `dataCollection` controls whose omitted fields collect data by default. It also uses streaming spans by default; `beforeSendTransaction` does not protect that path.

**Why:** Using older configuration examples with the installed SDK produced type errors and a runtime warning. Error tracking should not accidentally enable additional telemetry while upgrading SDKs.

**How to apply:** Check the installed SDK's types for collection controls and span filtering. Keep logs, metrics, tracing, and session collection disabled unless deliberately requested. Test fatal handlers in isolated processes against a local ingestion sink, not by crashing the app.

Distinguish ingestion acceptance from dashboard verification. A DSN permits sending events, not reading issues.

**Why:** Successful SDK ingestion does not independently prove an indexed event is visible in the intended organization. The connector can also reject provider redirects without implying the SDK or API credential is invalid.

**How to apply:** Verify dashboard claims through an authorized Sentry API read. If the connector reports a provider redirect, check the configured API/region hostname rather than repeatedly retrying or resetting credentials automatically.
