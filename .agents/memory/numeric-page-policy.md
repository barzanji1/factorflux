---
name: Numeric page scope and pagination
description: The user's system-wide numeric insights scope and default table page size.
---

Every numeric operational page is in scope for chart sections and top stat rows, not just Admin or the currently open page. Use neumorphic stat cards and concave chart containers, with compact 12–16px section gaps.

**Why:** The user explicitly confirmed “Every numeric page” when asked to clarify the scope.

**How to apply:** Preserve existing useful charts rather than adding duplicate per-page implementations. Summaries must describe the full authorized dataset, not only the visible table page, and retain existing role/assignment restrictions.

The default table page size is 15 in both the client and SQL-backed paginated endpoints.

**Why:** The user explicitly required server-side limits as well as the UI default; a visual slice alone does not satisfy a server-paginated table.

**How to apply:** Keep complete-data operations distinct from table pages. Do not cap report inputs, explicit full-result exports, entity selectors, background jobs, or chat/feed cursors at 15, because that would silently omit records or change workflows.
