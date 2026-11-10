---
name: Neumorphic depth policy
description: Compact shadows across all pages, including older one-off utilities.
---

Keep neumorphic shadows subtle across the system: raised cards approximately 4px/8px, buttons 3px/6px, general inset surfaces 3px/6px, and inputs 2px/4px, using #c8c8c8 rather than the darker old gray.

**Why:** The user reported that heavy offsets and blur made dense layouts look bloated, overlapping, and misaligned.

**How to apply:** Preserve focus indicators, colored status glows, layout dimensions, and behavior. Older arbitrary Tailwind shadow literals are also compacted during CSS processing; evaluate their emitted CSS, not only their source spelling. Keep this transformation idempotent so already compact shared tokens are not reduced repeatedly. Do not replace it with attribute selectors that infer the current state from an element's entire class string: an `active:` inset class must not make the default state inset.

The login is again an explicit exception to the neumorphic system used inside the application.

**Why:** After the solid neumorphic iteration, the user requested a dedicated reusable liquid-glass component instead of further card overrides.

**How to apply:** Follow [the dedicated panel policy](liquid-glass-panel-policy.md) for login only. Keep the original teal logo colors and the real TPF building's cinematic dusk treatment. Do not extend login glass effects to internal pages or restore the generated lobby.
