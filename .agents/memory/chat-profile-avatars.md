---
name: Chat profile avatars
description: Canonical avatar source and fallback requirements for Team Chat.
---

Team Chat must use agents' existing profile pictures, from the same source as sidebar/profile avatars. Do not create a separate chat-specific photo upload.

**Why:** The user explicitly requested one existing profile source and consistent avatars across channels, DMs, thread replies and mentions.

**How to apply:** Resolve pictures from the current staff profile when loading chat data. Use a shared colored-circle initials fallback for absent or failed images, never a blank avatar or broken-image icon. Keep the existing real-active-staff filtering for mention suggestions.
