---
name: Direct invoice seeds
description: Legacy database behavior affecting invoice seed scripts that do not create load records.
---

When inserting invoices directly without corresponding load rows, explicitly set `load_id` to `NULL` rather than omitting the column.

**Why:** The development database has a legacy sequence default on this nullable foreign-key column. Omitting it can generate an ID that does not exist in the loads table and roll back the insert.

**How to apply:** Include the column in direct invoice INSERT statements and supply `NULL` whenever the seed intentionally does not create loads.