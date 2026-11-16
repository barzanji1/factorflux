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

Loading states must be deliberate and immediately visible: an inline FactorFlux logo splash before application JavaScript, and lightweight structural placeholders while authenticated destinations prepare or fetch data. Apply navigation feedback to card links, notifications, programmatic navigation and browser history as well as the sidebar.

**Why:** After prior attempts hid loading states behind data-readiness waits, the user explicitly requested an inline logo splash, immediate dashboard skeletons, hover-prefetched routes, and immediate page-transition skeletons. This supersedes the earlier direction to hide all first-data placeholders. The neumorphic theme must not change.

**How to apply:** Keep the current shell usable while a destination's code and fresh permissions prepare; display loading structure only over its content area. Reveal mounted page structure without waiting for API completion. Preserve reduced motion, cancellation, fresh authorization, and history/query-string behavior. Verify deliberately delayed production assets and APIs, including the pending frame, rather than relying on development's module cache.

Do not use whole-window native view-transition snapshots for ordinary staff page navigation. Reserve them for the explicit login fade.

**Why:** A production-build pointer test caught a 156px sidebar collapse during whole-window transitions: snapshot overlays interrupt the live sidebar's hover/focus behavior. The shared pending content state does not require a whole-window animation.

**How to apply:** Keep navigation feedback content-only and measure sidebar width after actual pointer clicks while assets and API responses are delayed. Preserve normal hover expansion when the user deliberately enters or leaves the rail.
