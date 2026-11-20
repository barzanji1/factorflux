# Broker Activity release

The user approved atomic database capture. Existing broker portal pages, email
confirmation handlers, and first-response-wins rules remain unchanged.

## External PostgreSQL migration

Use the **database configured for the deployed application**, not an unrelated
Replit-managed database. Before publishing the Phase 2 app:

1. Apply `migrations/0058_broker_activity.sql`.
2. Apply `migrations/0059_broker_activity_atomic_capture.sql`.
3. Verify the trigger below, then publish the app.

Publish does **not** install these objects in an external database. Do not add
startup-time DDL or a broad schema push. Each SQL migration is transactional.
0059 waits up to 10 seconds for its short installation lock; a lock timeout
rolls the migration back, so retry the whole file during a quieter period.
It requires PostgreSQL 14 or later (`CREATE OR REPLACE TRIGGER`).

```sql
SELECT t.tgname, t.tgenabled, p.proname
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.broker_confirmation_events'::regclass
  AND t.tgname = 'broker_activity_atomic_capture'
  AND NOT t.tgisinternal;
```

Expect one row: `broker_activity_atomic_capture`, enabled `O` (or `A`),
function `capture_broker_activity_response`.

## Behavior

- The trigger snapshots the amount and actor and creates bell notifications
  and email delivery jobs in the **same transaction** as a confirmed/disputed
  event. If an audit/notification write fails, the broker response rolls back.
- It locks the invoice against concurrent edits while recording the snapshot.
- Actual email sending remains outside the response transaction, with existing
  opt-in checks, retry leases, and stable idempotency keys.
- Staff-entered confirmations are retained but are not mislabeled as Email
  responses or announced as broker actions.
- Test-account activity only notifies test-account managers/admins.
- Existing snapshots and catch-up records from before installation are marked
  historical; no old alerts or email jobs are replayed. Rerunning 0059 preserves
  snapshots captured by the already-installed trigger.
- The server checks for the enabled trigger before running its email worker.
  There is **no observer fallback** that could silently record a later amount.

## Verification

`npm run check`, `npm run build`, and:

```sh
node --import tsx --test server/services/brokerActivity.integration.test.ts
PRODUCTION_BROWSER_SCRIPT=scripts/verify-broker-activity-ui.mjs \
  node --import tsx scripts/verify-production-performance.ts
```

These use fictional test-account fixtures. The database test rolls back all
records; the browser test cleans up committed fixtures and sends no email.
