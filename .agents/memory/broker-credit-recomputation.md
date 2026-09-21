---
name: Broker credit recomputation
description: Concurrency rules for recalculating broker credit scores against the remote application database.
---

Run portfolio-wide broker credit calculations with bounded concurrency, but serialize the complete read/calculate/write cycle for each individual broker across application processes.

**Why:** Sequential portfolio recomputation against remote Neon exceeded the execution window, while unconstrained overlapping triggers can let an older calculation overwrite a newer current score.

**How to apply:** Keep bulk work bounded rather than sequential or unlimited, and acquire a broker-scoped database lock before reading financial inputs. Preserve the separate portfolio-level scheduler lock.