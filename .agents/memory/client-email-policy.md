---
name: Client email policy
description: Send-only client communication, permission scope, and the connected Resend key's limitations.
---

Client email is send-only. Use a professional sender on the verified company domain, route replies to the designated monitored inbox, and keep outbound content and sender attribution on the client profile. Do not introduce Gmail ingestion or an in-app inbox as part of this feature.

**Why:** The user explicitly requested send-only communication with replies handled in the monitored inbox.

**How to apply:** Keep send permission separate from client-profile read access, respect existing client assignments, and do not grant all agents send access automatically.

The correct company email domain is truckingprosfinancial.com, not tpfactoring.com.

**Why:** The user explicitly corrected the sender domain.

**How to apply:** Use truckingprosfinancial.com for company email senders; keep historical email logs unchanged.

All system mail uses the notifications mailbox on the company domain, with Reply-To still directed to the monitored mailbox. Do not add per-feature sender overrides.

**Why:** The user required one notifications sender everywhere, including environment settings, Resend, templates, and tests.

**How to apply:** Use the shared identity for all outbound mail and standalone scripts. Keep existing logs unchanged and do not replay unresolved old drafts with a changed envelope.

The connected Resend key is send-only. Domain-list requests return `restricted_api_key` with HTTP 401; that scope error alone is not evidence of a disconnected or invalid sending credential.

**Why:** Both the connected-service read and the application's connector SDK read returned this restriction after connection setup.

**How to apply:** Do not reconnect merely to fix unsupported metadata reads. Report domain-verification visibility limits honestly and distinguish provider acceptance from confirmed delivery.