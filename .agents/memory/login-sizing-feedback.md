---
name: Login sizing feedback
description: Interpret repeated requests for a smaller login as an actual proportional reduction.
---

When the user says the login card is still too large, reduce its actual rendered dimensions and its contents together; do not only recenter it or retain an older pixel target against the latest visual feedback.

**Why:** The user repeated that the card was too large after an earlier pass retained its dimensions and only corrected centering.

**How to apply:** Use real sizing declarations rather than a transform, scale the desktop panel and its internal spacing, typography, controls and icons proportionally, and preserve the approved background and current material direction. Keep mobile controls legible.

On the login, FactorFlux is the primary brand and Trucking Pros Financial is the tenant: present the tenant name more quietly and with clear side margins.

**Why:** The user explicitly identified TPF as the tenant and asked that it read as secondary to FactorFlux.

**How to apply:** Preserve this hierarchy in future login refinements. When the user asks for text-only changes, retain the card footprint rather than applying the earlier whole-card sizing approach.

Preserve the approved smaller login footprint when changing only the background.

**Why:** The user replaced the former lobby with the actual TPF office photo and asked to keep the card unchanged during background-only adjustments.

**How to apply:** Do not reintroduce the generated lobby or change the card to accommodate a background-only request. Keep short-screen and mobile layouts usable.

The user has explicitly abandoned the glass direction in favor of the system's neumorphic design.

**Why:** “The whole point: when someone sees the login page and then sees the dashboard after signing in, it should feel like the same system.”

**How to apply:** Follow [the neumorphic policy](neumorphic-depth-policy.md). Earlier Apple/Lumia/liquid-glass references, transparency requirements, and exact glass CSS values are superseded. Keep the real building backdrop rather than a generated lobby.
