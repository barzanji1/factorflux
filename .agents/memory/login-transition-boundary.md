---
name: Login entry and navigation
description: Subtle native sign-in crossfade, no fullscreen decorative effects, and no startup or destination loading flashes.
---

Successful staff sign-in may use a subtle native opacity crossfade into the prepared dashboard. Do not reintroduce the outward Sign In ripple, a cloned glass card, or a fullscreen success overlay. Keep the card-local hover effects separate and unchanged.

**Why:** The user removed the outward ripple after repeated sign-in glitches, then explicitly requested a smooth, gradual fade because the production sign-on felt abrupt. The new fade request supersedes the earlier no-animation direction, not the ban on ripples or copied overlays.

**How to apply:** Authenticate normally and prepare destination code while the real form stays steady. Scope native opacity transitions to staff login into the dashboard; ordinary staff navigation uses content-only feedback to preserve sidebar interaction. Reveal a structural dashboard skeleton immediately rather than holding the login snapshot for API completion. Keep transition styling alive through animation completion, clean it up on interruption, and skip animation for reduced motion or unsupported browsers. Preserve cancellation and every server/route permission check.

The login page intentionally loads eagerly. Anonymous home visits should enter login without first mounting the authenticated loading shell.

**Why:** The user reported a bare “Loading…” screen before sign-in. They subsequently explicitly requested a pure HTML/CSS FactorFlux logo splash before JavaScript loads; that intentional branded state is allowed, not an unstyled loading flash.

**How to apply:** Keep authenticated pages lazy and treat cached-session hints only as entry-page selection, never authentication. Preserve remembered-session and deep-link behavior.

Awaiting a route import alone does not guarantee that its first React.lazy mount avoids a Suspense fallback. A prepared component must choose its resolved implementation once per mount, not switch types on later renders.

**Why:** A cold/throttled production-build check still exposed loading frames after awaited imports; changing implementation types after mount would instead reset form state.

**How to apply:** Verify both startup and sign-in frame-by-frame on the production build, including reduced-motion/mobile paths. Check route guards and form-state continuity when changing lazy loading.

Commit verified authentication and prepared access state before a synchronous history navigation; do not rely on an awaited import to give React time to render.

**Why:** Downloading destination code alongside login removed an accidental network delay. In the production build, batched authentication updates had not committed when Wouter mounted the guard, so it saw signed-out state and redirected back to a freshly mounted, empty login form. Development's slower module loading hid the race.

**How to apply:** Keep the successful session and permissions commit atomic before changing history. Test cold and cached production assets, not just development. Preparing a route must not weaken fresh permission checks; discard abandoned preparations and commit the chosen snapshot before navigation.
