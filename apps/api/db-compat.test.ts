/**
 * Database compatibility layer tests
 * Tests that JSON fields work identically across PostgreSQL (native JSON) and SQLite (string storage)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { toJsonField, fromJsonField, isSQLite } from './src/db-compat.js';

describe('Database Compatibility Layer', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    // Reset DATABASE_URL before each test
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  describe('toJsonField', () => {
    it('should stringify objects for SQLite', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      const input = { version: 'latest', service: 'nginx' };
      const result = toJsonField(input);
      expect(result).toBe(JSON.stringify(input));
    });

    it('should pass through objects for PostgreSQL', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
      const input = { version: 'latest', service: 'nginx' };
      const result = toJsonField(input);
      expect(result).toEqual(input);
    });

    it('should handle empty objects for SQLite', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      const result = toJsonField({});
      expect(result).toBe('{}');
    });

    it('should handle empty objects for PostgreSQL', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
      const result = toJsonField({});
      expect(result).toEqual({});
    });

    it('should handle null/undefined for SQLite', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      expect(toJsonField(null)).toBe('{}');
      expect(toJsonField(undefined)).toBe('{}');
    });

    it('should handle null/undefined for PostgreSQL', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
      expect(toJsonField(null)).toEqual({});
      expect(toJsonField(undefined)).toEqual({});
    });

    it('should pass through strings as-is for SQLite', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      const result = toJsonField('{"already":"string"}');
      expect(result).toBe('{"already":"string"}');
    });

    it('should pass through strings as-is for PostgreSQL', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
      const result = toJsonField('{"already":"string"}');
      expect(result).toBe('{"already":"string"}');
    });
  });

  describe('fromJsonField', () => {
    it('should parse JSON strings to objects', () => {
      const input = '{"version":"latest","service":"nginx"}';
      const result = fromJsonField(input);
      expect(result).toEqual({ version: 'latest', service: 'nginx' });
    });

    it('should pass through objects as-is', () => {
      const input = { version: 'latest', service: 'nginx' };
      const result = fromJsonField(input);
      expect(result).toEqual(input);
    });

    it('should handle invalid JSON strings gracefully', () => {
      const result = fromJsonField('not valid json');
      expect(result).toEqual({});
    });

    it('should handle null/undefined', () => {
      expect(fromJsonField(null)).toEqual({});
      expect(fromJsonField(undefined)).toEqual({});
    });

    it('should handle empty string', () => {
      expect(fromJsonField('')).toEqual({});
    });
  });

  describe('isSQLite', () => {
    it('should return true for file: URLs', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      expect(isSQLite()).toBe(true);
    });

    it('should return false for postgresql: URLs', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
      expect(isSQLite()).toBe(false);
    });

    it('should return false when DATABASE_URL is not set', () => {
      delete process.env.DATABASE_URL;
      expect(isSQLite()).toBe(false);
    });
  });

  describe('Round-trip compatibility', () => {
    it('should maintain data integrity for SQLite round-trip', () => {
      process.env.DATABASE_URL = 'file:./test.db';
      const original = { version: 'latest', service: 'nginx', lines: 500 };
      const stored = toJsonField(original);
      const retrieved = fromJsonField(stored);
      expect(retrieved).toEqual(original);
    });

    it('should maintain data integrity for PostgreSQL round-trip', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
      const original = { version: 'latest', service: 'nginx', lines: 500 };
      const stored = toJsonField(original);
      const retrieved = fromJsonField(stored);
      expect(retrieved).toEqual(original);
    });

    it('should handle complex nested objects', () => {
      const complex = {
        task: 'install_docker',
        config: {
          version: 'latest',
          options: { privileged: true, network: 'host' }
        },
        metadata: { priority: 'high', timeout: 300 }
      };

      // Test SQLite
      process.env.DATABASE_URL = 'file:./test.db';
      const sqliteStored = toJsonField(complex);
      const sqliteRetrieved = fromJsonField(sqliteStored);
      expect(sqliteRetrieved).toEqual(complex);

      // Test PostgreSQL
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
      const pgStored = toJsonField(complex);
      const pgRetrieved = fromJsonField(pgStored);
      expect(pgRetrieved).toEqual(complex);
    });
  });
});
