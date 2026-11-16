---
name: Performance audit safety
description: Avoid false unused-code findings and misleading startup bundle measurements.
---

Use compiler diagnostics and the complete import/build graph for unused-code removal, not identifier text counts alone.

**Why:** React bindings can be used implicitly under this project's preserved JSX settings and test transforms. CSS build plugins and ambient declarations can also look unreachable to a browser-entry-only scan.

**How to apply:** Check compiler usage, build scripts, declarations, and module side effects before deleting candidates. Keep required implicit JSX imports.

Report the initial visible route's full JavaScript dependency closure separately from the entry chunk and the entire site's output.

**Why:** A lazy login adds dependencies after the entry loads. Code splitting can reduce startup substantially while increasing whole-site compressed output.

**How to apply:** Measure emitted file bytes and compression consistently, disclose both startup and total sizes, and verify the production resource graph rather than development-server module requests.

Do not equate loading-state continuity checks with fast navigation. When the user reports deployed delays, measure the live site's click-to-route and click-to-populated-content times, including repeat visits with no new chunk requests, before proposing more placeholders.

**Why:** Local compiled-bundle checks passed for layout continuity while the user still experienced production navigation delays. A clean layout assertion does not establish a latency budget, and a cached route can still wait on a network prerequisite.

**How to apply:** Separate code downloads, authorization preparation, page-data requests, and main-thread work. State the test location, cache conditions, and what “rendered” means; do not present local harness timings as deployed-site measurements.

Validate completed chart geometry separately from navigation continuity when changing shared rendering behavior.

**Why:** Navigation checks passed before the user reported stalled or missing graphics after a shared-renderer optimization. A mounted page and stable sidebar do not establish that its charts finished rendering.

**How to apply:** Check the compiled build for completed metric values, nonzero SVG dimensions, cylinder caps for positive data, valid SVG references, and resolved infographic loading states. Distinguish legitimate empty data from missing graphics; cover cached revisits and record-detail views too.
