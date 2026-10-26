---
name: Agent Dashboard policy
description: Default work-queue landing page, no project-management UI, and dashboard-specific manager visibility.
---

The Agent Dashboard is the default staff landing page and a work queue, not a project-management tool. No boards, cards, drag-and-drop, or sprints.

**Why:** The user explicitly required agents to see what needs action and click through to existing operational pages.

**How to apply:** Keep the four ordered work sections: My Queue, My Follow-ups, Team Activity, and system-wide Alerts. Reuse existing operational sources; the user approved actual source equivalents without adding tables or a task system.

Agents see their own invoice queues; managers see all agents' queues side by side. Team Activity and system alerts are staff-wide.

**Why:** The user explicitly requested all-agent queue visibility for managers, unlike the narrower team scope of personnel/performance reports.

**How to apply:** Apply this exception only to the workbench. Do not broaden personnel-report scope, entity mutation permissions, or staff account administration.

Performance optimizations must preserve the unfunded queue's live preflight checks, not replace them with saved intake snapshots.

**Why:** Broker/carrier conditions can change after intake; a faster dashboard must not hide new review actions.

**How to apply:** Batch current lookups and reuse the existing preflight rules. Keep acknowledgement semantics consistent when counting and limiting queue items.

Do not surface FMCSA run summaries or unverified/new-client onboarding state on the Agent Dashboard. Alerts are for actionable work today; an empty section should say "No alerts".

**Why:** The user clarified that imported new_client carriers are onboarding state, not agent alerts.

**How to apply:** Keep onboarding data/status and MC Check functionality intact outside this dashboard; retain actionable email/OCR failures and invoice preflight work.
