---
name: Browser verification context
description: Preview port and secure-origin requirements that can create false blank-page failures.
---

Verify the configured application port and the browser's secure context before diagnosing a blank signed-in page as an application regression.

**Why:** The default development hostname without the configured port reached an inspector rather than the application during browser checks. Direct plain HTTP on the development hostname then disabled secure-context APIs used by email composition, producing a false blank-page failure after legitimate login.

**How to apply:** Prefer the normal HTTPS Preview at its configured application port. For isolated direct-port browser checks, preserve the development Host header and emulate the secure origin in the test browser only. Keep authentication, application security, and deployment configuration unchanged. Do not treat a browser harness that has no secure context as evidence that the signed-in application is broken.

Verify pointer targets only after scrolling has settled.

**Why:** Smooth scrolling can move controls between measuring their position and sending a pointer event. This produces missed clicks and empty fields even when the component works correctly.

**How to apply:** Use instantaneous scrolling or wait for stable bounds before pointer checks. Confirm the actual target before diagnosing a failed checkbox or input as an application bug.
