---
name: Carrier-broker AR aging
description: Financial calculation rules for paired carrier and broker receivable reports.
---

Receivable aging starts on the invoice funded date, measured by America/Denver calendar dates rather than elapsed 24-hour periods, and includes only positive outstanding balances. Short-pay balances aggregate every applied payment and exclude resolved or waived exceptions. Write-offs settle open AR but do not count as cash collected. DSO ends on the payment event where cumulative cash first reaches the invoice amount.

**Why:** Other date bases admit unfunded records into aging, elapsed-hour math fails around day boundaries and DST, historical short-pay markers can outlive the shortage, and using the latest payment overstates collection time after an invoice was already paid.

**How to apply:** Use these rules for every threshold, DSO, short-pay total, CSV, PDF, and future AR view so inline and exported figures remain identical.