---
name: Chat notification cursors
description: Reliable polling rules for one-time Team Chat alerts, including newly discovered conversations.
---

Use paginated, monotonic server message IDs for notification polling. Establish initial history silently, serialize polls, and commit cursors only after a complete successful scan. For conversations first discovered in a later channel list, use the prior server watermark captured before that list was queried.

**Why:** Unread-count changes collapse multiple messages, latest-message checks can miss incoming messages behind a self-authored message, client timestamps are vulnerable to clock skew, and a watermark assembled from later per-channel requests can skip the first message in a concurrently created DM.

**How to apply:** Keep per-conversation cursors for known conversations. Have the server capture a global message watermark before producing the conversation list, retain the prior accepted watermark as the boundary for newly discovered conversations, and never let stale responses decrease it.