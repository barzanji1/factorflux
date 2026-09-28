---
name: Invoice number provenance
description: Historical invoice numbering ambiguity and safe treatment of carrier references.
---

Keep the globally unique system invoice identifier separate from a carrier-supplied invoice reference, which is unique only within that carrier. Do not automatically copy historical invoice identifiers into the carrier-reference field or silently renumber duplicates when restoring global uniqueness.

**Why:** Earlier code generated internal INV numbers for staff and bulk intake, but other paths could place user-provided values in that same column. Existing rows alone cannot reliably prove which values originated with carriers, and changing identifiers could break external references.

**How to apply:** Before backfilling carrier references or reconciling duplicate internal identifiers in another environment, establish row-level provenance and require explicit review for ambiguous rows. Fail migrations clearly rather than guessing.