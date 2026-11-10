---
name: Navigation loading continuity
description: Avoid large gray placeholder flashes and layout jumps during sidebar navigation.
---

Keep page structure and the current design visible while destination data loads; do not replace recognizable content with large gray blocks. Coverage must include every internal page, not only Calendar or pages using shared insights.

**Why:** The user repeatedly described initial loading placeholders as the old system flashing during sidebar navigation. Their Calendar screenshot identified a skeleton/layout issue distinct from route permission checks, and they explicitly clarified that it happens on every page.

**How to apply:** Keep loading geometry close to the loaded view, retain data-independent structure such as calendar dates, and show explicit loading labels rather than fabricated zero values. Verify real sidebar clicks with deliberately slow requests, including the pending frame—not just a screenshot taken after loading finishes. Preserve access checks and data freshness.

Viewport containment is a separate requirement from loading paint. An overflow-hidden shell does not reliably clip absolutely positioned descendants whose containing block is outside that shell; keep the viewport and scrolling-content containers positioned.

**Why:** Invisible screen-reader labels extended the document below the visible application, creating a blank bottom region despite apparently correct shell dimensions. Restyling skeletons could not fix this.

**How to apply:** Check document height, window scroll position, and shell bounds during real sign-in and navigation, not only the loaded page's appearance. Keep inner-content scrolling functional and preserve accessible labels rather than deleting them.
