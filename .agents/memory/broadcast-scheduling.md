---
name: Timed broadcast safety
description: Hosting consent, audience semantics, outage behavior and reliable queue verification.
---

Keep timed client broadcasts on always-on hosting.

**Why:** The user approved configuring Reserved VM rather than allowing Autoscale sleep to delay automatic holiday notices. This approval was for configuration; it did not authorize publishing.

**How to apply:** Preserve always-on hosting for reliable schedules. Hosting settings take effect only after a publish; do not describe a staged configuration as an already-running VM.

Scheduled audiences represent the confirmed filter rules at dispatch time, not a permanently frozen recipient count. Explicit client selections must remain restrictive after edits.

**Why:** The feature is intended to reach all clients in the chosen audience on the scheduled date, including clients added since scheduling. Quietly losing explicit selections would expose unintended clients to test emails.

**How to apply:** Explain the estimated count and dynamic audience before confirmation; evaluate the saved rules once when starting delivery, then preserve that final delivery snapshot and its retry identity.

Fail notices missed by more than 24 hours rather than emailing outdated closure wording automatically.

**Why:** This is a safety default against obsolete holiday notices after a prolonged outage, not a user-requested recurring-send rule.

**How to apply:** Surface the failure and require a newly reviewed notice/time. Do not silently extend this window without considering obsolete dates in the body.

Run queue integration suites serially when they share the same PostgreSQL dispatch state and advisory lock.

**Why:** Rolled-back fixture transactions still hold locks; a concurrent suite can legitimately make a worker skip its tick, producing misleading assertions about scheduled jobs.

**How to apply:** Use test-file concurrency of one for the shared-database broadcast suites. Do not weaken the production lock or interpret contention as a failed scheduled delivery.
