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
