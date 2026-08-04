/**
 * Task payload schema validation tests
 * Tests that task payloads are correctly validated and stored
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('Task Payload Schema Validation', () => {
  // This matches the schema validation in server.ts
  const taskSchema = z.object({
    serverId: z.string().uuid(),
    type: z.enum([
      'exec',
      'run_command',
      'update_packages',
      'install_docker',
      'restart_service',
      'collect_logs',
      'update_agent',
      'reboot',
      'restart_server',
      'shutdown',
      'restore_blueprint'
    ]),
    payload: z.record(z.unknown()).default({})
  });

  describe('install_docker payload', () => {
    it('accepts version-specific payload', () => {
      const result = taskSchema.safeParse({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'install_docker',
        payload: { version: 'latest' }
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty payload for install_docker', () => {
      const result = taskSchema.safeParse({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'install_docker',
        payload: {}
      });
      expect(result.success).toBe(true);
    });

    it('defaults to empty object if payload omitted', () => {
      const result = taskSchema.safeParse({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'install_docker'
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload).toEqual({});
      }
    });
  });

  describe('restart_service payload', () => {
    it('accepts service name payload', () => {
      const result = taskSchema.safeParse({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'restart_service',
        payload: { service: 'nginx' }
      });
      expect(result.success).toBe(true);
    });

    it('accepts other service names', () => {
      const result = taskSchema.safeParse({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'restart_service',
        payload: { service: 'docker' }
      });
      expect(result.success).toBe(true);
    });
  });

  describe('collect_logs payload', () => {
    it('accepts lines parameter', () => {
      const result = taskSchema.safeParse({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'collect_logs',
        payload: { lines: 500 }
      });
      expect(result.success).toBe(true);
    });

    it('accepts complex log parameters', () => {
      const result = taskSchema.safeParse({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'collect_logs',
        payload: { lines: 1000, unit: 'nginx', since: '1h ago' }
      });
      expect(result.success).toBe(true);
    });
  });

  describe('restore_blueprint payload', () => {
    it('accepts complex blueprint restoration payload', () => {
      const result = taskSchema.safeParse({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'restore_blueprint',
        payload: {
          blueprintVersionId: '550e8400-e29b-41d4-a716-446655440001',
          manifest: {
            name: 'web-stack',
            os: 'ubuntu-24.04',
            packages: ['docker.io', 'nginx']
          },
          compatibilityWarnings: []
        }
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Schema validation', () => {
    it('rejects invalid task types', () => {
      const result = taskSchema.safeParse({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'invalid_task_type',
        payload: {}
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid serverId format', () => {
      const result = taskSchema.safeParse({
        serverId: 'not-a-uuid',
        type: 'install_docker',
        payload: {}
      });
      expect(result.success).toBe(false);
    });

    it('accepts structured nested objects in payload', () => {
      const result = taskSchema.safeParse({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'install_docker',
        payload: {
          config: {
            version: 'latest',
            options: {
              privileged: true,
              network: 'host'
            }
          },
          metadata: {
            priority: 'high',
            timeout: 300
          }
        }
      });
      expect(result.success).toBe(true);
    });
  });
});
