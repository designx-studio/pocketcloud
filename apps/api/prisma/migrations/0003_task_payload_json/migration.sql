-- Change Task and Heartbeat payloads from TEXT to JSONB for structured data storage
-- This aligns the database schema with the API's object-based validation

-- Convert existing TEXT payloads to JSONB (they should already be JSON strings)
ALTER TABLE "Task" ALTER COLUMN "payload" TYPE JSONB USING payload::JSONB;
ALTER TABLE "Heartbeat" ALTER COLUMN "payload" TYPE JSONB USING payload::JSONB;
