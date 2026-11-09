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

The login reference requires a dark, clear navy center, localized cyan/silver upper-left reflections, and warm amber lower-right edge lighting. Inputs are dark glass; the button is rich teal, not gray-teal.

**Why:** The user repeatedly rejected both a solid dark card and an evenly cloudy silver-gray surface, then explicitly called the dark-clear material with localized cyan/amber reflections "excellent." Preserve that approved material while discussing sizing or placement separately.

**How to apply:** Preserve the existing architectural background while refining the glass surfaces; keep decorative layers pointer-transparent and form content crisp. Follow the user's explicit compact sizing rather than scaling the panel to the reference image's pixel bounds; the user rejected the oversized interpretation.

The user confirmed the compact card's size and positioning are correct. Material-only refinements must leave those, form layout, typography sizes, and branding unchanged.

**Why:** The user explicitly approved the geometry while rejecting the dark, opaque material.

**How to apply:** Replace conflicting dark fills and overlays rather than stacking additional effects; restrict future material corrections to surfaces, highlights, shadows, and contrast unless the user requests layout changes.
