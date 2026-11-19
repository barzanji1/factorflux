---
name: Institutional-finance visual scope
description: The approved Agent Dashboard is the visual reference across authenticated pages, with strict layout and behavior preservation.
---

Use the approved Agent Dashboard as the institutional-finance visual source of truth across authenticated Workspace, Communications, Funding, Operations, Risk, Recovery, and Admin pages, including nested details, forms, and dialogs. Do not introduce a different design direction.

**Why:** The user approved the dashboard and then explicitly expanded that exact visual language system-wide. This supersedes the earlier dashboard-only styling restriction.

**How to apply:** Preserve existing layouts, dimensions, positioning, sidebar groupings, workflows, permissions, financial logic, charts, data behavior, and carousel/card-flip motion. Extend only visual materials and control styling. Keep the approved dashboard appearance intact, and leave the architectural-glass login and public/customer-facing output outside the internal theme.

Dark mode is a palette-only option, not permission to redesign the workspace. Preserve the light theme exactly, preserve neumorphic structure and shadow geometry in both themes, and retain status/accent hues. The user's saved choice must apply before the first paint and remain consistent across sidebar controls and Settings.

**Why:** The user explicitly required dark mode without light-theme regressions, layout changes, or a wrong-theme loading flash.

**How to apply:** Extend the shared internal palette rather than modifying authentication, navigation behavior, APIs, or data. Check the financial dashboard's local palette and portaled controls as well as the global tokens; global tokens alone do not override locally declared colors.
