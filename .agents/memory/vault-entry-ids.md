---
name: Vault entry IDs
description: Legacy client_vault primary-key behavior that can break all new Vault entries.
---

Keep the client Vault primary key backed by a database sequence/default and represented as serial in the application schema.

**Why:** The table previously had a required integer ID with no default. Encryption succeeded, but every Vault create failed at insertion because the generated record had a null primary key.

**How to apply:** Preserve the sequence-backed default during schema synchronization and confirm it remains present after any table migration involving Vault records.