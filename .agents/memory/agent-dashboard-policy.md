---
name: Agent Dashboard policy
description: Default work-queue landing page, no project-management UI, and dashboard-specific manager visibility.
---

Keep Updated/Refresh with the dashboard header, above the time clock. The clock is separate from those controls and aligned with dashboard content, with 16px of space before Work Queue.

**Why:** The user corrected the placement after finding the refresh controls crowded the clock; these are page-header controls, not clock or work-queue content.

**How to apply:** Preserve this separation when rearranging the dashboard rather than putting refresh controls between the clock and Work Queue again.

The Agent Dashboard is the default staff landing page, not a project-management tool. No boards, kanban cards, task drag-and-drop, or sprints. Neumorphic section/KPI cards, the KPI carousel, and floating 3D action cards are explicitly approved.

**Why:** The user explicitly required agents to see what needs action and click through to existing operational pages.

**How to apply:** The user replaced the Operational Queue/My Queue table with six action cards (Create Invoice, Fund Queue, Follow-ups, Chargebacks, Reports, Ask Earl). Keep the financial charts and remaining sections below the grid. Reuse existing operational sources, without adding tables or a task system.

Agents see their own invoice queues; managers see all agents' queues side by side. Team Activity and system alerts are staff-wide.

**Why:** The user explicitly requested all-agent queue visibility for managers, unlike the narrower team scope of personnel/performance reports.

**How to apply:** Apply this exception only to the workbench. Do not broaden personnel-report scope, entity mutation permissions, or staff account administration.

Performance optimizations must preserve the unfunded queue's live preflight checks, not replace them with saved intake snapshots.

**Why:** Broker/carrier conditions can change after intake; a faster dashboard must not hide new review actions.

**How to apply:** Batch current lookups and reuse the existing preflight rules. Keep acknowledgement semantics consistent when counting and limiting queue items.

Do not surface FMCSA run summaries or unverified/new-client onboarding state on the Agent Dashboard. Alerts are for actionable work today; an empty section should say "No alerts".

**Why:** The user clarified that imported new_client carriers are onboarding state, not agent alerts.

**How to apply:** Keep onboarding data/status and MC Check functionality intact outside this dashboard; retain actionable email/OCR failures and invoice preflight work.

Do not reuse a normal-query cache key when changing a section to an infinite/paginated query.

**Why:** Retained normal-query data has no pages/pageParams; reusing its key caused a dashboard exception during the activity-feed migration before any request ran.

**How to apply:** Give structurally different response/query modes distinct keys while retaining the staff identity scope and common invalidation prefix.

Verify 3D-card navigation with real pointer hit-testing after the animation, not only DOM clicks or keyboard activation.

**Why:** Coplanar front/back faces with near-zero cursor tilt could render the back correctly and focus Go while the browser hit the container instead of the button.

**How to apply:** Keep the visible face's click targets stable, exclude hidden faces from interaction, and check the actual hit element before declaring a flip-card link functional.

Use one action-grid interaction model: front click/tap flips; Go navigates; back-face background or its close control returns to the front. No double-click or press-and-hold navigation.

**Why:** The user reported inconsistent first-click behavior after shortcuts were added and explicitly required their removal.

**How to apply:** Keep each card's face and animation state in React, ignore interaction during the flip, and keep tilt separate from the flip transition.
