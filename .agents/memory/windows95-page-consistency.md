---
name: Windows 95 page consistency
description: Visual consistency rule for internal FactorFlux pages and controls.
---

Use the shared Windows 95 content shell, controls, tables, and filter chips for authenticated internal pages except the Agent Dashboard, Invoice List, Invoice Detail, Create Invoice modal, Carrier List/Profile, and Broker List/Profile. The shared sidebar and these explicitly approved surfaces use neumorphism; other page content remains Win95.

**Why:** A page assembled directly from generic primitives drifted away from the established application theme and duplicated the title outside the shared header.

**How to apply:** Preserve the shared header actions and existing data, routes, and permissions. Treat Audit Trail as the content reference for pages not explicitly approved for migration.

The login page is the explicit exception: use a circular neumorphic card on desktop and mobile, without Win95 bevels. On mobile keep 20px margins and scale the contents proportionally; only below 320px may it become a fully rounded pill, never a square or ordinary rounded rectangle. Keep the login logo unlinked. Successful sign-in uses a 1200ms Y-axis coin-flip spin with perspective before dashboard navigation, never an upside-down Z-axis rotation; failed sign-in shakes it instead.

**Why:** The user initially requested login as the sole exception, then explicitly approved the Agent Dashboard, shared sidebar, invoice surfaces, Carrier List/Profile, and Broker List/Profile migrations while leaving other page content unchanged.

**How to apply:** Scope login styling to the login page so shared retro rules cannot override it and the exception cannot affect internal pages.

Login hierarchy is company-first: Trucking Pros Financial is the largest, boldest name; FactorFlux is a muted product label and Freight Factoring OS is a caption. Omit the divider and extra login heading/subtitle; use placeholder-only fields with accessible names.

**Why:** The user clarified that TPF is the company and FactorFlux is the product, and requested less visual weight around the form.

**How to apply:** Preserve clear branding-to-form spacing and at least 40px desktop background clearance when adjusting the login layout.

The reusable neumorphic system remains opt-in outside the approved dashboard, invoice surfaces, Carrier List/Profile, Broker List/Profile, and shared sidebar. Its admin preview must stay isolated from the Win95 shell and absent from sidebar navigation.

**Why:** The user requested review before migration and subsequently approved dashboard content, the global sidebar, invoice surfaces, Carrier List/Profile, and Broker List/Profile.

**How to apply:** Do not apply the library to existing pages without a new explicit request; use Tailwind classes rather than global CSS overrides.