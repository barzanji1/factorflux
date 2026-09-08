---
name: Carrier-broker AR aging
description: Financial calculation rules for paired carrier and broker receivable reports.
---

Carrier/broker aging starts on the invoice funded date and includes only invoices with a positive outstanding balance. Short-pay balances must aggregate every applied payment, not only lines marked as short pay.

**Why:** Using invoice or due dates admits unfunded records into aging, while summing only short-pay lines overstates the remaining shortage after other payments.

**How to apply:** Use these rules for every threshold, total, CSV, PDF, and future AR view so inline and exported figures remain identical.