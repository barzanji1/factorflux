---
name: Manager report scope
description: How team visibility is determined for performance reports and written warnings without a team-membership model.
---

Managers may view themselves and active users whose accounts identify that manager as creator; employees see only themselves, and administrators see all active users.

**Why:** The data model has no explicit manager or team-membership relationship, so account creator is the only available durable team proxy.

**How to apply:** Use this scope consistently for performance and personnel-warning APIs until a real team relationship is introduced, then migrate both together.