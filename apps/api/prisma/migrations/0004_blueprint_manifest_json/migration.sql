-- Store structured blueprint manifests as JSONB, matching the Prisma schema and API payloads.
ALTER TABLE "BlueprintVersion"
  ALTER COLUMN "manifest" TYPE JSONB
  USING "manifest"::JSONB;
