---
name: Chat verification
description: Real-staff-only directory policy and safe verification of chat interactions.
---

Team Chat autocomplete must contain only real, active staff. Example handles are not permission to seed fictional staff accounts.

**Why:** The user explicitly excludes test and inactive accounts. Persisted demo users or live test alerts would conflict with that requirement or disturb staff.

**How to apply:** Use isolated browser fixtures and rolled-back database writes to verify mentions and bell notifications. Distinguish those checks from live authenticated verification.

Use real pointer event sequences for pointer-driven browser controls rather than assuming a programmatic click exercises the control.

**Why:** A bell-menu fixture falsely failed because its trigger opens on pointer-down; a synthetic click alone did not exercise the actual interaction.

**How to apply:** For menu-trigger verification, send browser mouse/pointer press and release events. Test message clicks directly as well as their explicit Reply buttons.
