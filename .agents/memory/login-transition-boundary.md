---
name: Login transition boundary
description: Why successful login motion continues across navigation without delaying authentication.
---

The success transition is now a water ripple from the Sign In button (concentric rings, ~1.2s) that replaced the earlier glass shatter at the user's request. Navigate while the overlay still covers the screen, then fade the overlay so the dashboard appears underneath.

**Why:** The visual effect has to survive the login page unmounting; keeping it owned only by that page would cut it off at navigation.

**How to apply:** Keep transition cleanup independent of the login route after navigation begins, but cancel it if the user leaves before the reveal. Never delay or bypass authentication or permission checks to drive the animation. Preserve a reduced-motion path that reaches the dashboard without animation. The overlay clone must never carry credentials.

Do not uncover the destination on a fixed animation deadline alone. Navigation may proceed on schedule, but fade the login overlay only after the dashboard has committed and had a paint opportunity, with a bounded fallback for failed loads.

**Why:** A production sign-in succeeded while the lazy dashboard still loaded after the old overlay cleanup deadline, exposing a visible loading flash. Preloading alone did not eliminate the race on a cold connection.

**How to apply:** Preserve readiness-aware reveal and its timeout when changing route splitting or login motion. Verify frame-by-frame on a cold/throttled production build, not only the final dashboard.
