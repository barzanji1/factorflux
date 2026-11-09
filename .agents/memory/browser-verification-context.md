---
name: Browser verification context
description: Preview port and secure-origin requirements that can create false blank-page failures.
---

Verify the configured application port and the browser's secure context before diagnosing a blank signed-in page as an application regression.

**Why:** The default development hostname without the configured port reached an inspector rather than the application during browser checks. Direct plain HTTP on the development hostname then disabled secure-context APIs used by email composition, producing a false blank-page failure after legitimate login.

**How to apply:** Prefer the normal HTTPS Preview at its configured application port. For isolated direct-port browser checks, preserve the development Host header and emulate the secure origin in the test browser only. Keep authentication, application security, and deployment configuration unchanged. Do not treat a browser harness that has no secure context as evidence that the signed-in application is broken.

Node-based development API probes need the same hostname-to-loopback routing as the browser harness.

**Why:** The public development hostname did not reach the application port directly from a Node probe. Node 20 also requested all addresses from a custom DNS lookup; returning a single-address callback shape failed before the request reached the server.

**How to apply:** Preserve the development hostname and Host header while routing to the local application port. A custom lookup must respect its `all` option and return the matching address-list shape. Do not mistake transport failures for login or application errors.

Verify pointer targets only after scrolling has settled.

**Why:** Smooth scrolling can move controls between measuring their position and sending a pointer event. This produces missed clicks and empty fields even when the component works correctly.

**How to apply:** Use instantaneous scrolling or wait for stable bounds before pointer checks. Confirm the actual target before diagnosing a failed checkbox or input as an application bug.

Set the viewport explicitly after every new browser-debugging connection.

**Why:** A fresh connection can revert to a small default viewport despite an earlier connection setting desktop dimensions. This can clip popovers and invalidate screenshot comparisons without an application regression.

**How to apply:** Apply device metrics on each connection before measuring geometry, taking screenshots, or sending pointer events. Keep the cursor away from hover-expanding navigation while measuring a portaled menu.

Scope browser tests to the active dialog and the intended upload control.

**Why:** Nested dialogs leave background controls mounted. A generic checkbox selector can target the hold checkbox behind a preflight panel, and a generic PDF input selector can stage OCR intake files instead of required paperwork, clearing the prefill as designed.

**How to apply:** Identify the active dialog via its unique heading or close control, assert the pointer hit target, and select upload inputs by their labeled drop zone rather than MIME type alone.

Navigation checks must exercise a real pointer over the expanded sidebar and sample geometry across the route change, not only call a button's `.click()` and assert the destination.

**Why:** Programmatic navigation tests passed while missing a visible expanded-to-collapsed rail jump. They never exercised hover state during page remounts.

**How to apply:** Move the pointer into the rail, wait for expansion, click with pointer events, and check width and surface colors in successive animation frames. Also check keyboard activation, focus continuity, and normal collapse.
