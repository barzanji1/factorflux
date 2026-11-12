---
name: Broker receipt confirmation
description: Public receipt confirmation, sequential VP/RPS collections, safety boundaries, and hosting choice.
---

Broker receipt and dispute links open public pages. Record the response only after an explicit button submission, never merely from opening the link.

**Why:** The user chose the confirmation-button approach to avoid email security scanners falsely recording receipt.

**How to apply:** Preserve this policy when changing broker email templates or public endpoints. An opened-link event is not evidence of confirmed receipt.

Broker paperwork links must remain usable throughout the follow-up period. Use invoice-scoped bearer download links and generate short-lived storage signatures when opened; redact tokens in nested download request logs too.

**Why:** Brokers may review paperwork days or weeks after the email arrives, beyond a storage signature's lifetime. Those bearer links grant document access and must not leak through request logs.

**How to apply:** Never email short-lived storage URLs as the only paperwork link. Preserve invoice ownership checks and exclude private carrier identity/setup documents.

Keep the existing Autoscale deployment for the broker confirmation rollout.

**Why:** The user chose “Leave deployment unchanged” after being informed that Autoscale pauses background timers when idle and cannot guarantee 15-minute execution.

**How to apply:** Retain startup catch-up. Do not switch to Reserved VM hosting or add an external scheduler for this feature without new approval.

Automatic collections use sequential VP and RPS phases. VP sends at 48 and 96 hours after funding, then escalates to the designated call handler. Agent-confirmed VP starts a new clock: RPS at days 20, 35, and 40, then another call escalation. Agent-marked Paid stops the sequence.

**Why:** The user explicitly replaced the earlier 3/7/14-day reminder cadence with the two-phase collections sequence and requested integration with the existing first receipt email, not duplicate schedules.

**How to apply:** Keep one automatic schedule. Preserve earlier accepted receipt sends and history. Public broker responses remain explicit button submissions, but only an agent's VP confirmation starts RPS.

Keep simulations distinct from live progress. Changing a global mode must never silently promote simulated sends or confirmations into real workflow progress. Initial rollout is globally off and dry-run; live activation requires explicit confirmation.

**Why:** The user requires safe timing verification before contacting real brokers. Existing funded invoices can be overdue for several steps, so treating simulated progress as live could skip required contact or trigger unexpected escalations.

**How to apply:** Dry runs log would-send/would-notify events without real mail or bells. Global off, per-invoice pause/stop, and failure pauses govern every automatic entry point. Resume failed delivery through its workflow, not an Email Log bypass.

Blocked or failed collections sends must be reported as run failures, not counted as successful processing. Preserve partial successes and distinguish simulated actions, provider acceptance, confirmed delivery, and uncertain acceptance.

**Why:** The user explicitly called false success in a collections engine dangerous. Preview's live-send restriction must be visible, not mistaken for a saved LIVE setting authorizing delivery.

**How to apply:** Propagate invoice-level failures through every manual and scheduled entry point and show the actual reason in the UI. Never bypass the Preview guard to test real mail; use an isolated recipient in published production.

The manual Paid action is a collections stop marker, not evidence of cash posting, invoice settlement, or ledger reconciliation.

**Why:** The user wants a clean payment-confirmation boundary that future auto-reconciliation can replace or augment, without changing the existing financial workflows.

**How to apply:** Clearly explain the distinction in the UI. Future reconciliation should invoke the same stop boundary only after independently validating payment.

Label an unsent broker confirmation action “Send”; use “Resend” only after a send is recorded. Determine availability separately from that label.

**Why:** The user explicitly requested “Send” for the Pending / Not sent state, rather than “Resend unavailable.” Lack of a previous send is not itself a reason to prohibit the first send.

**How to apply:** Use the recorded send timestamp for the label and preserve the existing Preview, funding, and terminal-state sending restrictions.
