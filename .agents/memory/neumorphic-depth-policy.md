---
name: Neumorphic depth policy
description: Compact shadows across all pages, including older one-off utilities.
---

Keep neumorphic shadows subtle across the system: raised cards approximately 4px/8px, buttons 3px/6px, general inset surfaces 3px/6px, and inputs 2px/4px, using #c8c8c8 rather than the darker old gray.

**Why:** The user reported that heavy offsets and blur made dense layouts look bloated, overlapping, and misaligned.

**How to apply:** Preserve focus indicators, colored status glows, layout dimensions, and behavior. Older arbitrary Tailwind shadow literals are also compacted during CSS processing; evaluate their emitted CSS, not only their source spelling. Keep this transformation idempotent so already compact shared tokens are not reduced repeatedly. Do not replace it with attribute selectors that infer the current state from an element's entire class string: an `active:` inset class must not make the default state inset.

The login now belongs to the same neumorphic system as the authenticated pages, not a separate glass theme.

**Why:** The user explicitly abandoned glassmorphism and wants the login to feel like a preview of the dashboard and invoice forms.

**How to apply:** Use a solid white/light-gray raised card with approximately 20px corners, shared inset form inputs, a raised teal-gradient button, and dark FactorFlux branding. No transparency, backdrop filters, or glass decorations on the card or controls. Keep the real TPF building as a separate cinematic dusk backdrop at about 35% brightness with slightly reduced saturation and a dark blue gradient. Do not restore the older circular login or former glass/lobby references.
