#!/usr/bin/env sh
set -eu

# Surface migration failures clearly before the API process starts.
if ! npx prisma migrate deploy; then
  echo ""
  echo "PocketCloud failed to start."
  echo ""
  echo "Database migration failed."
  echo ""
  echo "Review:"
  echo ""
  echo "/opt/pocketcloud/.env"
  echo ""
  echo "Ensure DATABASE_URL points at a reachable PostgreSQL instance."
  echo ""
  exit 1
fi

# Configuration validation runs inside Node (apps/api/src/config.ts).
# On failure it prints a structured diagnostic pointing at /opt/pocketcloud/.env
# instead of only a ZodError stack trace.
exec "$@"
