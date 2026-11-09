# Institutional finance UI migration

## Foundation and first batch

- The approved Agent Dashboard remains the visual source of truth in
  `styles/ff-financial-dashboard.css`; its dashboard-specific rules and geometry
  are unchanged.
- `App.tsx` adds that existing stylesheet's scope class and the
  `ff-institutional-root` marker to the existing authenticated root. The
  authenticated Neu Preview content applies the marker to its existing
  `NeuPageShell`; no route, content, or layout structure changed.
- `styles/ff-institutional-workspace.css` introduces palette aliases and visual
  paint rules for authenticated pages, shared legacy surfaces, and narrowly
  scoped Radix/toast portals. Page geometry and semantic status colors remain
  page-owned.
- Shared Neu components add stable visual marker classes and semantic variant
  data attributes; their existing defaults are retained outside this scope.

### Workspace and Communications coverage

- Workspace route surface: dashboard/shared chrome, clients and client detail,
  brokers and broker detail, invoices and invoice detail, documents, tasks and
  task detail, calendar, help, activities, profile, settings, download,
  landing, chat, bulk invoices, and agent portal submissions.
- Communications surface: client email, email log, broadcast/composer/schedule
  dialogs and IT Support/ticket routes.
- Shared detail/forms/dialog primitives are covered through the authenticated
  scope and shared Neu markers, with page-family selectors retaining their
  existing fallback defaults outside the authenticated scope.
- Exact legacy neutral-gray surfaces are mapped by their explicit utility class
  only; button/status text semantics and chart series remain unchanged. The
  shared admin-family paint aliases were brought forward for IT Support, with
  legacy fallback values retained when the institutional tokens are absent.

### Explicit exclusions

Login and public portal screens, email HTML/PDF, dashboard-specific
paint/shapes/motion (including the dashboard Earl action grid), backend/API/data
behavior, route/auth logic, and all layout metrics remain untouched.

### Funding, Operations, and Risk batch

- Funding family paint now consumes institutional aliases in its existing
  stylesheet; coverage includes factoring, funding queue/sheets, payouts,
  cash application, lockbox, bank transfers, and fuel-advance tracking.
- Operations family paint now consumes aliases for trucks, dispatchers, and
  release-letter pages and their existing dialogs/previews.
- Risk family paint now consumes aliases for credit checks, FMCSA authority,
  held invoices, and audit-log detail expanders.
- Payout/load detail and carrier onboarding inherit the shared admin-family
  aliases; fuel-advance detail uses the authenticated surface marker.
- Portal alias declarations are set only on selected dialog, menu/listbox,
  popover, and toast roots so body-level portals can resolve shared values.
- Chart SVG series/data colors, geometry, workflow, and calculations remain
  unchanged.

### Recovery and Administration final batch

- Recovery follow-ups, collections, and reports use the institutional aliases
  for their existing controls, tabs, filters, table customization, dropdowns,
  dialogs, detail/edit surfaces, and chart panels.
- Administration coverage includes users/permissions, time, carrier portal,
  factoring settings, document requirements, audit log, payroll, expenses,
  vault, rules, workflow builder, and the full-page Earl assistant.
- Shared PageInsights chart and stat surfaces use the institutional material;
  SVG series colors/data and chart behavior are unchanged.
- Profile, settings, download, landing, and activities inherit the authenticated
  shared foundation. Explicit neutral text utilities map only within protected
  main content and selected portal surfaces; status/badge and SVG colors are
  excluded.
- Paint-only aliases retain the original stylesheet fallbacks outside the
  authenticated institutional root. No routes, permission rules, APIs, data,
  or layout metrics were changed.
- Nested details, create/edit dialogs, drawers, dropdowns, and overlays inherit
  the same family treatment through existing page markers and selected portal
  roots, not broad body-wide paint selectors.

## Verification status and scope

- TypeScript checking and the production build pass. All 25 relevant automated
  tests pass, including five new palette, scope, paint-only, native-prop, and
  semantic-variant checks. A pre-existing schema test was repaired to look up
  the broker schema in its existing shared module; validation was not changed.
- Desktop before/after checks covered 38 authenticated pages across all seven
  navigation groups, with unchanged sampled element widths and heights. Three
  real-record detail screens and the Create Invoice modal also retained their
  measured geometry at matching viewports.
- Twelve mobile checks covered six representative pages at both 375px and
  390px: no viewport overflow and no measured layout changes when switching
  the authenticated material layer on/off.
- Actual pointer and keyboard checks passed for sidebar navigation, MC Check
  history, funding type filters, report/Aging sub-tabs, Admin Time Tracking,
  and Create Invoice opening/Escape closing. These were read-oriented checks;
  funding, payment, approval, and outbound-email workflows were not executed.
- Login and public portal routes were checked for absence of the internal
  theme marker. Their source/assets, authentication, and login shatter animation
  remain unchanged. No backend, API, schema, dependency, or deployment changes.
- The production build still reports its existing large-chunk warning; this
  migration adds no dependencies or expensive animation effects.
- Internal AccessDenied returns accept the institutional marker on the existing
  root only; permission and navigation logic are unchanged. Neu Preview remains
  content/layout-identical while its existing page shells now receive theme
  tokens.
- The floating Earl prompt belongs to the approved dashboard action grid and
  remains unchanged with the dashboard source. Full-page Earl is included.
- Only login and public portal surfaces remain outside the authenticated theme.
  Dashboard-specific paint and chart data/series remain independently protected.
