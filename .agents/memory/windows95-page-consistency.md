---
name: Windows 95 page consistency
description: Visual consistency rule for internal FactorFlux pages and controls.
---

Use the shared Windows 95 content shell, controls, tables, and filter chips for authenticated internal pages except the Agent Dashboard, Invoice List, Invoice Detail, Create Invoice modal, Carrier List/Profile, Broker List/Profile, Documents, Tasks list, Help Center, Calendar, Team Chat, Bulk Invoices, Portal Submissions, Email Log, Email Client (including its composers and broadcast dialogs), Funding pages (Factoring, Sheets, Payments/cash application, Lockbox, Fuel Advance, Bank Transfers), Operations pages (Dispatchers, Trucks, Release Letters), Risk pages (C/B Reviews, MC Check, Held, Logs/Audit Trail), Recovery pages (Followups and Reports, including all report tabs and customization controls), and Admin surfaces (all Admin tabs, Payroll, Expenses, Vault, Rules, Workflow Builder, Earl). The shared sidebar and these explicitly approved surfaces use neumorphism; other page content remains Win95.

**Why:** A page assembled directly from generic primitives drifted away from the established application theme and duplicated the title outside the shared header.

**How to apply:** Preserve the shared header actions and existing data, routes, and permissions. Use the remaining Win95 surfaces as references for pages not explicitly approved for migration; Audit Trail is now approved for neumorphism.

Neumorphic migrations must override the shell's legacy normalization locally, including portaled controls. Using a neumorphic component alone does not establish its rendered appearance.

**Why:** The global Win95 rules use important declarations and high-specificity selectors; they can silently restore square cards and beveled inputs despite correct component imports.

**How to apply:** Keep overrides inside the approved page surface, not around the sidebar. Verify computed border radius, borders, and shadows in the browser, and check dialogs separately because portals escape the page scope.

The login page is the explicit exception: use a circular neumorphic card on desktop and mobile, without Win95 bevels. On mobile keep 20px margins and scale the contents proportionally; only below 320px may it become a fully rounded pill, never a square or ordinary rounded rectangle. Keep the login logo unlinked. Successful sign-in uses a 1200ms Y-axis coin-flip spin with perspective before dashboard navigation, never an upside-down Z-axis rotation; failed sign-in shakes it instead.

**Why:** The user initially requested login as the sole exception, then explicitly approved the Agent Dashboard, shared sidebar, invoice surfaces, Carrier List/Profile, Broker List/Profile, Documents, Tasks list, Help Center, Calendar, Team Chat, Bulk Invoices, and Portal Submissions migrations while leaving other page content unchanged.

**How to apply:** Scope login styling to the login page so shared retro rules cannot override it and the exception cannot affect internal pages.

Login hierarchy is company-first: Trucking Pros Financial is the largest, boldest name; FactorFlux is a muted product label and Freight Factoring OS is a caption. Omit the divider and extra login heading/subtitle; use placeholder-only fields with accessible names.

**Why:** The user clarified that TPF is the company and FactorFlux is the product, and requested less visual weight around the form.

**How to apply:** Preserve clear branding-to-form spacing and at least 40px desktop background clearance when adjusting the login layout.

The reusable neumorphic system remains opt-in outside the approved surfaces listed above. Its admin preview must stay isolated from the Win95 shell and absent from sidebar navigation.

**Why:** The user requested review before migration and subsequently approved the surfaces listed above, including Funding, Operations, Risk, Recovery, and Admin. These approvals are styling-only: preserve workflows, validation, API calls, and permissions.

**How to apply:** Do not apply the library to existing pages without a new explicit request; use Tailwind classes rather than global CSS overrides.