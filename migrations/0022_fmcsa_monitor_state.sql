ALTER TABLE "compliance_integration_runs"
  ADD COLUMN IF NOT EXISTS "reason" text,
  ADD COLUMN IF NOT EXISTS "detail" jsonb,
  ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp DEFAULT now() NOT NULL,
  ADD COLUMN IF NOT EXISTS "lease_token" varchar;

ALTER TABLE "broker_authority_checks"
  ADD COLUMN IF NOT EXISTS "authority_status" varchar,
  ADD COLUMN IF NOT EXISTS "check_error" text;

UPDATE "broker_authority_checks"
SET
  "authority_status" = CASE
    WHEN upper(coalesce("authority_status", '')) = 'NO_API_KEY'
      OR "check_status" = 'no_key'
      OR upper(coalesce("common_authority_status", '')) = 'NO_API_KEY'
      OR upper(coalesce("broker_authority_status", '')) = 'NO_API_KEY'
      THEN NULL
    WHEN "allowed_to_operate" = false
      OR upper(coalesce("common_authority_status", '')) LIKE '%NOT AUTHORIZED%'
      OR upper(coalesce("broker_authority_status", '')) LIKE '%NOT AUTHORIZED%'
      THEN 'NOT_AUTHORIZED'
    WHEN upper(coalesce("common_authority_status", '')) LIKE '%INACTIVE%'
      OR upper(coalesce("common_authority_status", '')) LIKE '%REVOKED%'
      OR upper(coalesce("broker_authority_status", '')) LIKE '%INACTIVE%'
      OR upper(coalesce("broker_authority_status", '')) LIKE '%REVOKED%'
      THEN 'INACTIVE'
    WHEN "allowed_to_operate" = true
      OR upper(coalesce("common_authority_status", '')) LIKE '%ACTIVE%'
      OR upper(coalesce("broker_authority_status", '')) LIKE '%ACTIVE%'
      THEN 'ACTIVE'
    ELSE 'UNKNOWN'
  END,
  "check_status" = CASE
    WHEN upper(coalesce("authority_status", '')) = 'NO_API_KEY'
      OR "check_status" = 'no_key'
      OR upper(coalesce("common_authority_status", '')) = 'NO_API_KEY'
      OR upper(coalesce("broker_authority_status", '')) = 'NO_API_KEY'
      THEN 'skipped'
    WHEN "check_status" = 'api_error' THEN 'error'
    WHEN "check_status" = 'not_found' AND "entity_type" <> 'broker' THEN 'error'
    ELSE 'ok'
  END,
  "check_error" = CASE
    WHEN upper(coalesce("authority_status", '')) = 'NO_API_KEY'
      OR "check_status" = 'no_key'
      OR upper(coalesce("common_authority_status", '')) = 'NO_API_KEY'
      OR upper(coalesce("broker_authority_status", '')) = 'NO_API_KEY'
      THEN 'missing api key'
    WHEN "check_status" = 'not_found'
      THEN coalesce("error_message", 'not in QCMobile carrier dataset')
    ELSE "error_message"
  END
WHERE
  "authority_status" IS NULL
  OR "check_error" IS NULL
  OR "check_status" IN ('success', 'not_found', 'api_error', 'no_key');

ALTER TABLE "broker_authority_checks"
  ADD CONSTRAINT "broker_authority_checks_check_status_valid"
    CHECK ("check_status" IN ('ok', 'error', 'skipped')) NOT VALID,
  ADD CONSTRAINT "broker_authority_checks_authority_status_valid"
    CHECK ("authority_status" IS NULL OR "authority_status" IN ('ACTIVE', 'INACTIVE', 'NOT_AUTHORIZED', 'UNKNOWN')) NOT VALID;

ALTER TABLE "broker_authority_checks"
  VALIDATE CONSTRAINT "broker_authority_checks_check_status_valid";

ALTER TABLE "broker_authority_checks"
  VALIDATE CONSTRAINT "broker_authority_checks_authority_status_valid";

UPDATE "compliance_integration_runs"
SET
  "status" = 'failed',
  "completed_at" = coalesce("completed_at", now()),
  "reason" = coalesce("reason", 'Interrupted before completion')
WHERE "status" = 'running';

CREATE UNIQUE INDEX IF NOT EXISTS "compliance_integration_runs_single_running_idx"
  ON "compliance_integration_runs" ("status")
  WHERE "status" = 'running';