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
