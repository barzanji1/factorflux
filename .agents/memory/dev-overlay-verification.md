---
name: Dev-overlay verification
description: Distinguishing development-tool overlays from application failures during browser interaction tests.
---

A development-only runtime overlay can block pointer interaction after an external resource failure or native ResizeObserver notification, without an application JavaScript exception.

**Why:** Browser verification encountered a normal-looking page with normal body pointer styles, but hit-testing identified an intercepting runtime overlay. It reported an unknown error while captured browser events identified a failed development banner script and native ResizeObserver notifications.

**How to apply:** Inspect the actual hit target and captured window errors before attributing a blocked click to application state. If development tooling is the blocker, verify the built frontend with isolated API fixtures and assert that there are no JavaScript exceptions or unhandled rejections. Keep authentication and genuine error reporting intact; report the development-only limitation explicitly rather than disabling overlays to make a test pass.
