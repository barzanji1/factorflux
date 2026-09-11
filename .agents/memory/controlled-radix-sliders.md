---
name: Controlled Radix sliders
description: How to keep controlled slider interactions functional when persistence happens on commit.
---

When a Radix slider is controlled from fetched server data, maintain a local draft value with `onValueChange` and persist that draft with `onValueCommit`.

**Why:** Binding `value` directly to unchanged query data while handling only `onValueCommit` can prevent dragging from advancing the controlled value, so the commit does not reliably fire with the intended result.

**How to apply:** Use local component state for slider movement, synchronize it when fresh server data arrives, and invalidate or refresh the relevant query after a successful commit.