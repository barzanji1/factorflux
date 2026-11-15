---
name: Login entry and navigation
description: No fullscreen sign-in effects; avoid initial and destination loading flashes.
---

Do not reintroduce the outward Sign In ripple, a cloned glass card, or a fullscreen success overlay. Keep the card-local hover effects separate and unchanged.

**Why:** The user explicitly removed the outward ripple because it was affecting the page after repeated reports of sign-in glitches.

**How to apply:** Authenticate normally, prepare the destination while the real login form stays steady, and navigate without decorative success animation. Preserve cancellation when the user leaves and all server/route permission checks.

The login page intentionally loads eagerly. Anonymous home visits should enter login without first mounting the authenticated loading shell.

**Why:** The user reported the brief “Loading…” screen before the sign-in form. Making login lazy introduced a visible startup state despite loading approximately the same total login dependencies.

**How to apply:** Keep authenticated pages lazy and treat cached-session hints only as entry-page selection, never authentication. Preserve remembered-session and deep-link behavior.

Awaiting a route import alone does not guarantee that its first React.lazy mount avoids a Suspense fallback. A prepared component must choose its resolved implementation once per mount, not switch types on later renders.

**Why:** A cold/throttled production-build check still exposed loading frames after awaited imports; changing implementation types after mount would instead reset form state.

**How to apply:** Verify both startup and sign-in frame-by-frame on the production build, including reduced-motion/mobile paths. Check route guards and form-state continuity when changing lazy loading.

Commit verified authentication and prepared access state before a synchronous history navigation; do not rely on an awaited import to give React time to render.

**Why:** Downloading destination code alongside login removed an accidental network delay. In the production build, batched authentication updates had not committed when Wouter mounted the guard, so it saw signed-out state and redirected back to a freshly mounted, empty login form. Development's slower module loading hid the race.

**How to apply:** Keep the successful session and permissions commit atomic before changing history. Test cold and cached production assets, not just development. Preparing a route must not weaken fresh permission checks; discard abandoned preparations and commit the chosen snapshot before navigation.
