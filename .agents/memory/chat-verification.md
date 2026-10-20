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

Browser interaction checks must assert that the intended input has focus before replacement typing, and verify its resulting value rather than treating dispatched events as proof of input.

**Why:** Dialog transitions and viewport changes can redirect a pointer/keyboard sequence to the page instead of the intended input, producing misleading test results without an application error.

**How to apply:** Wait for dismissed dialogs to release pointer capture and confirm input focus/value when testing composer edits, retries, and mobile layouts.
