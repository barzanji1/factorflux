---
name: Chat notification cursors
description: Reliable polling rules for one-time Team Chat alerts, including newly discovered conversations.
---

Use paginated, monotonic server message IDs for notification polling. Establish initial history silently, serialize polls, and commit cursors only after a complete successful scan. For conversations first discovered in a later channel list, use the prior server watermark captured before that list was queried.

**Why:** Unread-count changes collapse multiple messages, latest-message checks can miss incoming messages behind a self-authored message, client timestamps are vulnerable to clock skew, and a watermark assembled from later per-channel requests can skip the first message in a concurrently created DM.

**How to apply:** Keep per-conversation cursors for known conversations. Have the server capture a global message watermark before producing the conversation list, retain the prior accepted watermark as the boundary for newly discovered conversations, and never let stale responses decrease it.

Chat alerts must remain clearly audible. Each user chooses Chime, Voice, or Mute; Voice is opt-in, never forced. Preserve prior mute choices, incoming-only filtering, no-replay behavior, and suppression for the actively viewed conversation.

**Why:** The user reported that agents could not hear the previous notification sound over typical work noise and explicitly required individual choice rather than forcing voice notifications on everyone.

**How to apply:** Preserve audible alert strength when changing chat audio, while retaining notification guards and avoiding overlapping chimes.

Voice notifications must use an original recording or AI-generated voice saying "You've got a message", never the AOL notification recording or its "You've Got Mail" phrase.

**Why:** The user explicitly prohibited that recording and phrase. The approved message clip was generated independently with text-to-speech, not sampled from another notification.

**How to apply:** Keep this restriction when replacing or regenerating notification assets.