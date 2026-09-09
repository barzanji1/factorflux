---
name: Fuel advance compatibility
description: Compatibility and accounting rules while legacy fuel advances coexist with the rebuilt workflow.
---

Preserve legacy fuel-advance fields and JSON creation compatibility while the normalized carrier, broker, load, rate, fee, and payment fields are adopted. Treat unknown historical financial values as unavailable, never as zero.

**Why:** Historical rows do not contain every field required by the rebuilt workflow. Displaying absent fees or totals as zero creates materially misleading accounting output, while removing the legacy contract can break older callers.

**How to apply:** Keep schema changes additive, make PDFs and detail views null-aware, and synchronize the paid checkbox with the legacy paid status until historical data has been fully normalized.