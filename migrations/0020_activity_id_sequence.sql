CREATE SEQUENCE IF NOT EXISTS "activities_id_seq";

SELECT setval(
  '"activities_id_seq"',
  COALESCE((SELECT MAX("id") FROM "activities"), 0) + 1,
  false
);

ALTER SEQUENCE "activities_id_seq" OWNED BY "activities"."id";

ALTER TABLE "activities"
  ALTER COLUMN "id" SET DEFAULT nextval('"activities_id_seq"');