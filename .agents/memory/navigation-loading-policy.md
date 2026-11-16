---
name: Navigation loading continuity
description: Show-first staff loading policy, cached snapshots, first-visit skeletons, and persistent navigation.
---

Use the user's show-first, fetch-second policy across staff pages. Render a data-independent shell immediately, show cached real data on revisits, mark cache entries stale after 60 seconds, and refresh entries older than 30 seconds quietly in the background.

**Why:** The user explicitly replaced previous loading/deferral approaches with this application-wide architecture. Earlier requests to suppress gray placeholders no longer apply to uncached first visits.

**How to apply:** Only an uncached first visit may show gray placeholders matching content geometry. Replace them with complete data content in one swap; no page-content spinners, loading text, or progressive chart fill. Cached charts and infographics render immediately and refresh in place without skeleton swaps. Start independent page requests together, preserve authorization and account isolation, and test rapid sidebar navigation in the compiled production build.

Reserve stable chart slots, including empty-data slots where charts were previously omitted.

**Why:** The user explicitly accepted fixed chart slots so first-visit placeholders can reserve predictable geometry before conditional chart definitions arrive.

**How to apply:** Preserve those slots during loading and empty-data states rather than collapsing the chart area or independently deferring charts.

Viewport containment is a separate requirement from loading paint. An overflow-hidden shell does not reliably clip absolutely positioned descendants whose containing block is outside that shell; keep the viewport and scrolling-content containers positioned.

**Why:** Invisible screen-reader labels extended the document below the visible application, creating a blank bottom region despite apparently correct shell dimensions. Restyling skeletons could not fix this.

**How to apply:** Check document height, window scroll position, and shell bounds during real sign-in and navigation, not only the loaded page's appearance. Keep inner-content scrolling functional and preserve accessible labels rather than deleting them.

Keep route-level code splitting, but do not separately lazy-load or defer charts and infographics. Preserve the login page, email templates, and the existing neumorphic theme and component styling.

**Why:** The user made these explicit boundaries part of the show-first loading overhaul.

**How to apply:** Keep the current shell usable while destination code prepares; revalidate the previously verified permission snapshot in the background without weakening server-side authorization. Preserve reduced motion, cancellation, permission revocation, and history/query-string behavior. Measure click-to-structural-shell against the user's 100 ms target separately from data completion; verify delayed production assets/APIs and cached repeat visits rather than relying on development's module cache.

Do not use whole-window native view-transition snapshots for ordinary staff page navigation. Reserve them for the explicit login fade.

**Why:** A production-build pointer test caught a 156px sidebar collapse during whole-window transitions: snapshot overlays interrupt the live sidebar's hover/focus behavior. The shared pending content state does not require a whole-window animation.

**How to apply:** Keep navigation feedback content-only and measure sidebar width after actual pointer clicks while assets and API responses are delayed. Preserve normal hover expansion when the user deliberately enters or leaves the rail.

The desktop sidebar belongs to the signed-in session, not to each page. Route-owned sidebar calls should reuse the shared host rather than mount another desktop rail; mobile drawers remain independent.

**Why:** Width continuity checks alone passed while live navigation still destroyed and rebuilt the sidebar on every click. The user approved fixing its lifetime, not masking the remount with more loading states.

**How to apply:** Assert the same connected sidebar node across route changes as well as stable geometry, and preserve pinning, scroll, focus, notifications and permission-filtered links.
