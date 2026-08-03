-- Store structured blueprint manifests as JSONB, matching the Prisma schema and API payloads.
-- Legacy installs may contain empty or non-JSON text. Convert those rows to a
-- valid JSON object instead of aborting the whole production migration.
ALTER TABLE "BlueprintVersion" ADD COLUMN "manifest_json" JSONB;

DO $$
DECLARE
  row_data RECORD;
BEGIN
  FOR row_data IN SELECT "id", "manifest" FROM "BlueprintVersion" LOOP
    BEGIN
      UPDATE "BlueprintVersion"
      SET "manifest_json" = CASE
        WHEN row_data."manifest" IS NULL OR btrim(row_data."manifest") = '' THEN '{}'::jsonb
        ELSE row_data."manifest"::jsonb
      END
      WHERE "id" = row_data."id";
    EXCEPTION WHEN others THEN
      UPDATE "BlueprintVersion"
      SET "manifest_json" = jsonb_build_object('legacy_manifest', row_data."manifest")
      WHERE "id" = row_data."id";
    END;
  END LOOP;
END $$;

ALTER TABLE "BlueprintVersion" DROP COLUMN "manifest";
ALTER TABLE "BlueprintVersion" RENAME COLUMN "manifest_json" TO "manifest";
ALTER TABLE "BlueprintVersion" ALTER COLUMN "manifest" SET NOT NULL;
