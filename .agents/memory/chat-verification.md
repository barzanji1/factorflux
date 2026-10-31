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

Browser interaction checks must assert that the document and intended input have focus before keyboard input, and verify the resulting value or action rather than treating dispatched events as proof.

**Why:** Dialog transitions and viewport changes can redirect a pointer/keyboard sequence away from the intended input. A focused element in an inactive document, or key events without native default activation, can also falsely suggest a broken control.

**How to apply:** Wait for dismissed dialogs to release pointer capture and confirm document focus, input focus/value, and native activation when testing controls. For hidden/inert panels, make the destination interactive before moving focus into it; focusing an inert descendant fails silently.

Assert that isolated browser fixtures are active before testing message sends, not just that their injection was requested.

**Why:** Browser protocol calls can fail without throwing in a thin driver; a disabled Page domain can leave real chat transport active instead of installing new-document fixtures.

**How to apply:** Check protocol errors and an in-page fixture marker before any Send interaction. Stop if either check fails; never send verification messages to live staff.
