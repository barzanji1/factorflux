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

The office is closed on all federal holidays. Holiday and closure templates are editable starting text. Admins can prepare the year's notices in advance, but each schedule requires explicit review and confirmation.

**Why:** The user stated “FactorFlux is closed all FEDERAL HOLIDAYS” and requested all eleven federal holiday notices plus generic closure/hours templates.

**How to apply:** Include all eleven holidays, present actual and federally observed dates as reviewable defaults, preserve editable closure wording/hours, and never promise funding during a holiday. Resolve Company personalization per recipient with a neutral fallback.

Shared custom templates may be saved by staff with client-email access, independently of the admin-only broadcast boundary.

**Why:** The user requested agents/admins create reusable templates without asking to broaden mass-send permission.

**How to apply:** Saving or selecting a template never sends anything. Preserve editable draft snapshots, existing recipient scoping, and individual broadcast deliveries.

Use a native selector for the shared long template list inside email dialogs.

**Why:** Long portal-based menus in the nested composer caused focus/scroll interactions to select the wrong item or fail to reach a saved custom template during browser verification.

**How to apply:** Preserve real keyboard and pointer verification; do not rely on scrolling a portal option's DOM node into view as proof that clicking will reach it.