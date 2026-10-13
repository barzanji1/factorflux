---
name: Broker receipt confirmation
description: User-approved confirmation action policy and hosting choice.
---

Broker receipt and dispute links open public pages. Record the response only after an explicit button submission, never merely from opening the link.

**Why:** The user chose the confirmation-button approach to avoid email security scanners falsely recording receipt.

**How to apply:** Preserve this policy when changing broker email templates or public endpoints. An opened-link event is not evidence of confirmed receipt.

Keep the existing Autoscale deployment for the broker confirmation rollout.

**Why:** The user chose “Leave deployment unchanged” after being informed that Autoscale pauses background timers when idle and cannot guarantee 15-minute execution.

**How to apply:** Retain startup catch-up. Do not switch to Reserved VM hosting or add an external scheduler for this feature without new approval.

Automatic initial broker confirmation waits 48 hours after funding. Reminder cadence remains 3, 7, and 14 days after the first send, not after funding.

**Why:** The user changed the initial delay from 24 to 48 hours while explicitly preserving the reminder cadence.

**How to apply:** Keep automatic initial eligibility and the scheduled candidate query aligned. Do not apply the initial-delay gate to reminders for emails already sent manually.

Label an unsent broker confirmation action “Send”; use “Resend” only after a send is recorded. Determine availability separately from that label.

**Why:** The user explicitly requested “Send” for the Pending / Not sent state, rather than “Resend unavailable.” Lack of a previous send is not itself a reason to prohibit the first send.

**How to apply:** Use the recorded send timestamp for the label and preserve the existing Preview, funding, and terminal-state sending restrictions.
