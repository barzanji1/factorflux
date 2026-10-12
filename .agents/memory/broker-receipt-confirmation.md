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
