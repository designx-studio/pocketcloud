/**
 * Database compatibility layer.
 * SQLite stores JSON as strings; PostgreSQL stores native JSON.
 * These helpers let server.ts read/write JSON fields transparently
 * regardless of which database backend is active.
 */

/** Serialize a value to JSON string for SQLite, or pass through for PostgreSQL */
export function toJsonField(value: unknown): unknown {
  if (process.env.DATABASE_URL?.startsWith('file:')) {
    return typeof value === 'string' ? value : JSON.stringify(value ?? {});
  }
  // For PostgreSQL, pass through non-null values, but convert null/undefined to {}
  return value ?? {};
}

/** Deserialize a JSON field from SQLite string, or pass through for PostgreSQL */
export function fromJsonField(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.trim() === '') return {};
    try {
      return JSON.parse(value);
    } catch (err) {
      console.warn(`[db-compat] Stored JSON field is not parseable, falling back to {}: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }
  }
  return value ?? {};
}

/** Whether the current database is SQLite */
export function isSQLite(): boolean {
  return Boolean(process.env.DATABASE_URL?.startsWith('file:'));
}
