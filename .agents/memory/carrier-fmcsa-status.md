---
name: Carrier FMCSA status
description: Conservative interpretation of QCMobile carrier authority for invoice decisions.
---

Derive carrier status from carrier operating and allowed-to-operate signals before common/contract authority classes. Conflicting active and adverse class signals without a definitive carrier-level result mean UNKNOWN, not INACTIVE. Ignore broker-only authority fields for carriers; failed or missing checks must not block invoices.

**Why:** Carriers can have inactive common authority while retaining active contract authority. Treating any adverse class as a whole-carrier failure would falsely block eligible invoices.

**How to apply:** New FMCSA carrier fields or preflight rules must preserve the distinction between a definitive carrier-level inactive/not-authorized result and partial or conflicting authority-class evidence.