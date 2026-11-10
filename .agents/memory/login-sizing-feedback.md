---
name: Login sizing feedback
description: Interpret repeated requests for a smaller login as an actual proportional reduction.
---

When the user says the login card is still too large, reduce its actual rendered dimensions and its contents together; do not only recenter it or retain an older pixel target against the latest visual feedback.

**Why:** The user repeated that the card was too large after an earlier pass retained its dimensions and only corrected centering.

**How to apply:** Use real sizing declarations rather than a transform, scale the desktop panel and its internal spacing, typography, controls and icons proportionally, and preserve the approved background and glass finish. Keep mobile controls legible.

On the login, FactorFlux is the primary brand and Trucking Pros Financial is the tenant: present the tenant name more quietly and with clear side margins.

**Why:** The user explicitly identified TPF as the tenant and asked that it read as secondary to FactorFlux.

**How to apply:** Preserve this hierarchy in future login refinements. When the user asks for text-only changes, retain the card footprint rather than applying the earlier whole-card sizing approach.

Preserve the approved smaller login card and its material when changing the background.

**Why:** After requesting floor placement over the former lobby, the user replaced that scene with the actual TPF office photo and explicitly asked to keep the glass card exactly as-is.

**How to apply:** Do not reintroduce the generated lobby or change the card to accommodate a background-only request. Keep short-screen and mobile layouts usable.

The user set the smaller card footprint and prohibited card pseudo-element reflections. Later they supplied an Apple liquid-glass reference and repeatedly rejected opaque gray/blue panels, superseding their initial exact material values.

**Why:** The user wants clear dimensional glass without losing the existing dusk effect on the building. Brightening the entire background to make the card more visible was explicitly corrected.

**How to apply:** The latest visual target is the supplied “Liquid Glass Freight Login” image: match its login card only, explicitly ignore its lobby. It shows a rounded dimensional glass edge, curved light catches, clear frosted center, teal mark, white text and pill-shaped controls. Preserve the real building's dusk treatment, card footprint, text hierarchy and ripple behavior. Earlier numerical CSS requests were attempts to achieve transparency, not approval of the resulting dark panel. Do not claim native Apple refraction from CSS blur and decorative highlights.

Over the dusk building photo, use light translucent white glass rather than the former dark navy card.

**Why:** The user found the dark card blended into the background and explicitly requested light frosted glass for contrast.

**How to apply:** Preserve the approved card footprint and teal button; do not restore dark opaque card fills during later contrast refinements.
