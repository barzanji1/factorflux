---
name: Windows 95 page consistency
description: Visual consistency rule for internal FactorFlux pages and controls.
---

Use the shared Windows 95 page shell, cards, stats, controls, tabs, tables, badges, and filter chips for authenticated internal pages. Treat Audit Trail as the reference implementation and extract its patterns rather than redesigning them independently.

**Why:** A page assembled directly from generic primitives drifted away from the established application theme and duplicated the title outside the shared header.

**How to apply:** Put breadcrumb, title, subtitle, global search, New menu, notifications, and user controls in the shared page shell. Do not render a second body H1. Keep page data, actions, routes, and permissions unchanged when migrating visual surfaces.

The login page is the explicit exception: use a circular neumorphic desktop card and rounded mobile card, without Win95 bevels. Keep the login logo unlinked. Successful sign-in spins the card before dashboard navigation; failed sign-in shakes it instead.

**Why:** The user explicitly requested neumorphic styling for login only; authenticated internal pages must retain their existing Win95 style.

**How to apply:** Scope login styling to the login page so shared retro rules cannot override it and the exception cannot affect internal pages.