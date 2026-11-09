---
name: Neumorphic depth policy
description: Compact shadows across all pages, including older one-off utilities.
---

Keep neumorphic shadows subtle across the system: raised cards approximately 4px/8px, buttons 3px/6px, general inset surfaces 3px/6px, and inputs 2px/4px, using #c8c8c8 rather than the darker old gray.

**Why:** The user reported that heavy offsets and blur made dense layouts look bloated, overlapping, and misaligned.

**How to apply:** Preserve focus indicators, colored status glows, layout dimensions, and behavior. Older arbitrary Tailwind shadow literals are also compacted during CSS processing; evaluate their emitted CSS, not only their source spelling. Keep this transformation idempotent so already compact shared tokens are not reduced repeatedly. Do not replace it with attribute selectors that infer the current state from an element's entire class string: an `active:` inset class must not make the default state inset.

The login page is an exception: the user replaced its circular neumorphic design with a financial-institution lobby and a rectangular frosted-glass card. Keep this visual treatment isolated to login; do not extend it to the authenticated dashboard or other pages.

**Why:** The user explicitly requested an enterprise financial institution entry experience while preserving all authentication behavior and leaving authenticated pages unchanged.

**How to apply:** Do not restore the old circular gray login when changing global neumorphic components. Preserve the shared FactorFlux platform and Trucking Pros Financial company branding on staff login.

Prioritize login readability over the earlier see-through glass treatment: a distinct, more opaque navy surface, dark inputs, white brand/company text, and a vivid teal button. Keep reflections restrained.

**Why:** After earlier glass experiments, the user explicitly said the contents were getting lost against the background and requested a more solid surface. This supersedes the earlier preference against opacity.

**How to apply:** Do not revert to lighter transparency merely to match an older reference. Preserve the architectural background, compact sizing, and pointer-transparent decoration; do not enlarge the panel to the reference image's pixel bounds.

After approving the glass material, the user explicitly chose reference-like near-square proportions and a floor-grounded placement, with a narrow contact shadow and cyan/amber reflected light beneath the panel.

**Why:** The user wants a freestanding architectural glass panel that appears to rest on the lobby floor, rather than a wide floating modal.

**How to apply:** Preserve the high-contrast navy glass when refining proportions or placement. Keep floor effects noninteractive and outside the clipped glass surface; allow scrolling on short screens rather than clipping the form.
