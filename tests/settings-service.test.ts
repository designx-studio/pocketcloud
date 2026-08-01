import { describe, it, expect, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { decryptSecret, encryptSecret } from '../apps/api/src/security.js';
import { SETTINGS, listSettings, seedDefaultSettings, settingUpdateSchema, updateSetting, validateSetting } from '../apps/api/src/settings-service.js';

type SettingRow = { key: string; value: string; category: string; isSecret: boolean; updatedAt: Date; updatedBy?: string };

function createPrismaStub(rows: SettingRow[] = []) {
  const auditLogs: Array<Record<string, unknown>> = [];
  const upserts: Array<Record<string, unknown>> = [];
  const store = new Map(rows.map((row) => [row.key, row]));
  const prisma = {
    setting: {
      findMany: async () => [...store.values()],
      upsert: async ({ where, update, create }: any) => {
        upserts.push({ where, update, create });
        const existing = store.get(where.key);
        const row = existing
          ? { ...existing, ...update, updatedAt: new Date('2024-02-02T00:00:00Z') }
          : { updatedAt: new Date('2024-02-02T00:00:00Z'), ...create };
        store.set(where.key, row);
        return row;
      }
    },
    auditLog: {
      create: async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }
    }
  };
  return { prisma: prisma as unknown as PrismaClient, auditLogs, upserts, store };
}

describe('settings-service', () => {
  describe('validateSetting', () => {
    it('coerces and normalizes values for every known setting', () => {
      expect(validateSetting('agentHeartbeatInterval', '30')).toMatchObject({ key: 'agentHeartbeatInterval', value: '30', secret: false, category: 'agents' });
      expect(validateSetting('backupEnabled', 'true').value).toBe('true');
      expect(validateSetting('aiApiKey', 'sk-test')).toMatchObject({ secret: true, category: 'integrations' });
      expect(validateSetting('controlPlaneName', 'Fleet HQ').description).toBe(SETTINGS.controlPlaneName.description);
    });

    it('rejects out-of-range and malformed values', () => {
      expect(() => validateSetting('unknownKey', 'x')).toThrow('unsupported_setting');
      expect(() => validateSetting('agentHeartbeatInterval', '1')).toThrow();
      expect(() => validateSetting('agentHeartbeatInterval', '2.5')).toThrow();
      expect(() => validateSetting('backupRetentionDays', '0')).toThrow();
      expect(() => validateSetting('diskThreshold', '-1')).toThrow();
      expect(() => validateSetting('controlPlaneName', '')).toThrow();
    });
  });

  describe('settingUpdateSchema', () => {
    it('accepts optional value and rotate flags', () => {
      expect(settingUpdateSchema.parse({ key: 'domain', value: 'cloud.example.com' })).toEqual({ key: 'domain', value: 'cloud.example.com' });
      expect(settingUpdateSchema.parse({ key: 'aiApiKey', rotate: true })).toEqual({ key: 'aiApiKey', rotate: true });
      expect(() => settingUpdateSchema.parse({ value: 'no-key' })).toThrow();
    });
  });

  describe('listSettings', () => {
    it('masks secrets, keeps plain values, and drops unknown keys', async () => {
      const { prisma } = createPrismaStub([
        { key: 'controlPlaneName', value: 'PocketCloud', category: 'general', isSecret: false, updatedAt: new Date('2024-01-01T00:00:00Z'), updatedBy: 'usr-1' },
        { key: 'aiApiKey', value: encryptSecret('sk-live-abcd1234'), category: 'integrations', isSecret: true, updatedAt: new Date('2024-01-01T00:00:00Z') },
        { key: 'removedSetting', value: 'stale', category: 'general', isSecret: false, updatedAt: new Date('2024-01-01T00:00:00Z') }
      ]);

      const settings = await listSettings(prisma);

      expect(settings.map((setting: any) => setting.key)).toEqual(['controlPlaneName', 'aiApiKey']);
      expect(settings[0]).toMatchObject({ value: 'PocketCloud', isSecret: false, updatedBy: 'usr-1' });
      expect(settings[1]!.value).toBe('••••••••1234');
      expect(settings[1]!.value).not.toContain('sk-live');
    });

    it('masks short secrets entirely', async () => {
      const { prisma } = createPrismaStub([
        { key: 'aiApiKey', value: encryptSecret('ab'), category: 'integrations', isSecret: true, updatedAt: new Date('2024-01-01T00:00:00Z') }
      ]);

      const [setting] = await listSettings(prisma);
      expect(setting!.value).toBe('••••');
    });
  });

  describe('updateSetting', () => {
    let stub: ReturnType<typeof createPrismaStub>;

    beforeEach(() => {
      stub = createPrismaStub();
    });

    it('stores plain values and writes an audit log entry', async () => {
      const result = await updateSetting(stub.prisma, 'usr-1', '10.0.0.5', { key: 'cpuThreshold', value: '90' });

      expect(result).toMatchObject({ key: 'cpuThreshold', value: '90', isSecret: false, category: 'agents', updatedBy: 'usr-1' });
      expect(stub.auditLogs).toHaveLength(1);
      expect(stub.auditLogs[0]).toMatchObject({ userId: 'usr-1', action: 'setting_update', resource: 'Setting', resourceId: 'cpuThreshold', ipAddress: '10.0.0.5' });
      expect(JSON.parse(stub.auditLogs[0]!.metadata as string)).toEqual({ key: 'cpuThreshold', category: 'agents', secret: false });
    });

    it('encrypts secret values and returns only a masked value', async () => {
      const result = await updateSetting(stub.prisma, 'usr-1', undefined, { key: 'aiApiKey', value: 'sk-live-abcd1234' });

      expect(result.value).toBe('••••••••1234');
      const stored = stub.store.get('aiApiKey')!.value;
      expect(stored).not.toContain('sk-live-abcd1234');
      expect(decryptSecret(stored)).toBe('sk-live-abcd1234');
    });

    it('refuses to persist a masked placeholder back over a secret', async () => {
      await expect(updateSetting(stub.prisma, 'usr-1', undefined, { key: 'aiApiKey', value: '••••••••1234' })).rejects.toThrow('secret_replacement_required');
      await expect(updateSetting(stub.prisma, 'usr-1', undefined, { key: 'aiApiKey' })).rejects.toThrow('secret_replacement_required');
      expect(stub.auditLogs).toHaveLength(0);
    });

    it('rejects unknown keys and invalid values before touching the database', async () => {
      await expect(updateSetting(stub.prisma, 'usr-1', undefined, { key: 'nope', value: 'x' })).rejects.toThrow('unsupported_setting');
      await expect(updateSetting(stub.prisma, 'usr-1', undefined, { key: 'memoryThreshold', value: '150' })).rejects.toThrow();
      expect(stub.upserts).toHaveLength(0);
    });
  });

  describe('seedDefaultSettings', () => {
    it('creates every default without overwriting existing rows', async () => {
      const stub = createPrismaStub();

      await seedDefaultSettings(stub.prisma, 'cloud.example.com');

      expect(stub.upserts).toHaveLength(10);
      expect(stub.upserts.every((upsert) => Object.keys(upsert.update as object).length === 0)).toBe(true);
      expect(stub.store.get('domain')).toMatchObject({ value: 'cloud.example.com', category: 'general', isSecret: false });
      expect(stub.store.get('cpuThreshold')).toMatchObject({ value: '85', category: 'agents' });
      expect(stub.store.has('aiApiKey')).toBe(false);
    });

    it('seeds values that pass their own validation schema', async () => {
      const stub = createPrismaStub();

      await seedDefaultSettings(stub.prisma, 'cloud.example.com');

      for (const [key, row] of stub.store) {
        expect(() => validateSetting(key, row.value)).not.toThrow();
      }
    });
  });
});
