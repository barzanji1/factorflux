---
name: Client email policy
description: Outbound-mail identity, composer scope versus staff-wide log reads, and Resend connection limitations.
---

Client email is send-only. Use a professional sender on the verified company domain, route replies to the designated monitored inbox, and keep outbound content and sender attribution on the client profile. Do not introduce Gmail ingestion or an in-app inbox as part of this feature.

**Why:** The user explicitly requested send-only communication with replies handled in the monitored inbox.

**How to apply:** Keep send permission separate from client-profile read access, respect existing client assignments, and do not grant all agents send access automatically.

Client broadcasts are admin-only. Employees and managers must not gain mass-send access through `client_email`, Full Access, or a delegated admin module. The existing assigned-client rule still governs employees' single-client emails.

**Why:** The user explicitly chose admin-only broadcasts rather than extending mass-send access to permissioned staff.

**How to apply:** Enforce the active administrator role on every broadcast endpoint and before queued delivery, not only in the UI. Each broadcast recipient receives a separate email with no shared To/CC/BCC list.

The correct company email domain is truckingprosfinancial.com, not tpfactoring.com.

**Why:** The user explicitly corrected the sender domain.

**How to apply:** Use truckingprosfinancial.com for company email senders; keep historical email logs unchanged.

All system mail uses the notifications mailbox on the company domain, with Reply-To still directed to the monitored mailbox. Do not add per-feature sender overrides.

**Why:** The user required one notifications sender everywhere, including environment settings, Resend, templates, and tests.

**How to apply:** Use the shared identity for all outbound mail and standalone scripts. Keep existing logs unchanged and do not replay unresolved old drafts with a changed envelope.

The connected Resend key is send-only. Domain-list requests return `restricted_api_key` with HTTP 401; that scope error alone is not evidence of a disconnected or invalid sending credential.

**Why:** Both the connected-service read and the application's connector SDK read returned this restriction after connection setup.

**How to apply:** Do not reconnect merely to fix unsupported metadata reads. Report domain-verification visibility limits honestly and distinguish provider acceptance from confirmed delivery.

The system-wide outbound Email Log is readable by all authenticated staff, independently of client-profile and send permissions. Managers can retry failed messages; staff cannot edit or delete history.

**Why:** The user explicitly requested a shared Communications log visible to all agents, not a client-assignment-scoped log.

**How to apply:** Keep global log reads separate from composer permissions and existing entity access rules. Do not grant send, entity-edit, or log-edit privileges merely to enable log visibility.

Retry original messages without exposing their full HTML in the shared log. Preserve the original envelope and delivery intent; a verified delivery must supersede an uncertain local send result.

**Why:** The user requires preview-only history and manager retries. A lost acceptance response or the provider's expiring idempotency cache must not cause duplicate customer emails.

**How to apply:** Keep retry bodies private and encrypted, maintain durable intent correlation, and never allow the read-only log to edit recipients or message content.

All new outbound emails share one modern, mobile-readable company template. Win95 styling is for the app, not emails. Payment instructions must use configured company values or be omitted; never send seeded banking placeholders.

**Why:** The user explicitly requested consistent branding across all outbound email types and removal of fake payment details.

**How to apply:** Apply branding at the single transport, including text-only and direct sends. Preserve immutable historical retries, but refuse unsafe placeholder instructions. Corporate bank routing numbers alone are not proof of fake details.