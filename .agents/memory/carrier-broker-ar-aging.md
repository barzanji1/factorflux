---
name: Receivable report semantics
description: Financial calculation rules for carrier/broker AR and chargeback reconciliation reports.
---

Receivable aging starts on the invoice funded date, measured by America/Denver calendar dates rather than elapsed 24-hour periods, and includes only positive outstanding balances. Short-pay balances aggregate every applied payment and exclude resolved or waived exceptions. Write-offs settle open AR but do not count as cash collected. DSO ends on the payment event where cumulative cash first reaches the invoice amount.

**Why:** Other date bases admit unfunded records into aging, elapsed-hour math fails around day boundaries and DST, historical short-pay markers can outlive the shortage, and using the latest payment overstates collection time after an invoice was already paid.

**How to apply:** Use these rules for every threshold, DSO, short-pay total, CSV, PDF, and future AR view so inline and exported figures remain identical.

## Aging matrix definitions

The Aging report keeps funding-date aging: Current is funding day 0, followed by days 1–30, 31–60, 61–90, and over 90. Its date range filters funding dates, not historical balance snapshots; amount bounds filter individual outstanding balances before grouping.

**Why:** The user asked to keep the existing aging source while adding standard bucket columns and filters. Switching to due-date aging would change the financial meaning, and including day 90 in both final buckets would double-count it.

**How to apply:** Preserve these definitions across carrier/broker views, totals, and exports. Do not reinterpret Current as “not yet due” or the end-date filter as an as-of accounting reconstruction.

## Chargeback reconciliation

The Chargeback report's Short Pays section includes zero-paid funded invoices as well as partial payments; do not silently narrow it to invoices with short-pay exception records.

**Why:** The user's definition for this report is cash applied < invoice amount, not the existence of a variance marker.

**How to apply:** Retain the positive-open-balance and resolved/waived exclusions above, while aggregating all applied cash, including zero.

Keep the three section totals separate rather than adding them into one financial grand total.

**Why:** A charged-back invoice can also be short-paid, and reserve movements represent a different accounting category. Combining them double-counts receivables.

**How to apply:** Preserve independent totals in both the screen and exports.