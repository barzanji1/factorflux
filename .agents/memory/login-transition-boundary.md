---
name: Login transition boundary
description: Why successful login motion continues across navigation without delaying authentication.
---

Reveal the authenticated dashboard while the success fragments are still moving, rather than waiting for every fragment to disappear before routing.

**Why:** The user requested that the dashboard fade in as the glass fragments fly out. The visual effect therefore has to survive the login page unmounting; keeping it owned only by that page would cut it off at navigation.

**How to apply:** Keep transition cleanup independent of the login route after navigation begins, but cancel it if the user leaves before the reveal. Never delay or bypass authentication or permission checks to drive the animation. Preserve a reduced-motion path that reaches the dashboard without the shatter.
