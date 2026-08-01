import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { decryptSecret, encryptSecret } from './security.js';

export const SETTINGS = {
  controlPlaneName: { category: 'general', secret: false, schema: z.string().min(1).max(120), description: 'Display name shown in the dashboard.' },
  domain: { category: 'general', secret: false, schema: z.string().min(1).max(253), description: 'Public control-plane hostname or IP.' },
  agentHeartbeatInterval: { category: 'agents', secret: false, schema: z.coerce.number().int().min(5).max(3600), description: 'Agent heartbeat interval in seconds.' },
  cpuThreshold: { category: 'agents', secret: false, schema: z.coerce.number().min(0).max(100), description: 'CPU alert threshold percentage.' },
  memoryThreshold: { category: 'agents', secret: false, schema: z.coerce.number().min(0).max(100), description: 'Memory alert threshold percentage.' },
  diskThreshold: { category: 'agents', secret: false, schema: z.coerce.number().min(0).max(100), description: 'Disk alert threshold percentage.' },
  backupEnabled: { category: 'backups', secret: false, schema: z.coerce.boolean(), description: 'Enable scheduled control-plane backups.' },
  backupRetentionDays: { category: 'backups', secret: false, schema: z.coerce.number().int().min(1).max(3650), description: 'Number of days to retain backups.' },
  notificationsEnabled: { category: 'notifications', secret: false, schema: z.coerce.boolean(), description: 'Enable operational notifications.' },
  aiProvider: { category: 'integrations', secret: false, schema: z.string().max(80), description: 'AI diagnostics provider name.' },
  aiApiKey: { category: 'integrations', secret: true, schema: z.string().min(1).max(4096), description: 'AI diagnostics provider credential.' }
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const settingUpdateSchema = z.object({ key: z.string(), value: z.string().optional(), rotate: z.boolean().optional() });
const mask = (value: string) => value.length <= 4 ? '••••' : `••••••••${value.slice(-4)}`;

export function validateSetting(key: string, raw: string): { key: SettingKey; value: string; secret: boolean; category: string; description: string } {
  const definition = SETTINGS[key as SettingKey];
  if (!definition) throw new Error('unsupported_setting');
  const parsed = definition.schema.parse(raw);
  return { key: key as SettingKey, value: String(parsed), secret: definition.secret, category: definition.category, description: definition.description };
}

export async function listSettings(prisma: PrismaClient) {
  const rows = await prisma.setting.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
  return rows.map((row: any) => {
    const definition = SETTINGS[row.key as SettingKey];
    if (!definition) return null;
    let value = row.value;
    let decryptionFailed = false;
    if (row.isSecret) {
      try {
        value = mask(decryptSecret(row.value));
      } catch (err) {
        // One unreadable secret must not take down the whole settings page,
        // but the operator has to know the stored value cannot be decrypted.
        console.error(`[settings] Unable to decrypt secret '${row.key}':`, err instanceof Error ? err.message : err);
        value = '';
        decryptionFailed = true;
      }
    }
    return { key: row.key, category: row.category, value, isSecret: row.isSecret, decryptionFailed, description: definition.description, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }).filter(Boolean);
}

export async function updateSetting(prisma: PrismaClient, userId: string, ipAddress: string | undefined, input: z.infer<typeof settingUpdateSchema>) {
  const definition = SETTINGS[input.key as SettingKey];
  if (!definition) throw new Error('unsupported_setting');
  if (definition.secret && (!input.value || input.value.includes('••••'))) throw new Error('secret_replacement_required');
  const validated = validateSetting(input.key, input.value ?? '');
  const stored = definition.secret ? encryptSecret(validated.value) : validated.value;
  const row = await prisma.setting.upsert({ where: { key: validated.key }, update: { value: stored, category: validated.category, isSecret: validated.secret, updatedBy: userId }, create: { key: validated.key, value: stored, category: validated.category, isSecret: validated.secret, updatedBy: userId } });
  await prisma.auditLog.create({ data: { userId, action: 'setting_update', resource: 'Setting', resourceId: row.key, ipAddress, metadata: JSON.stringify({ key: row.key, category: row.category, secret: row.isSecret }) } });
  return { key: row.key, category: row.category, value: row.isSecret ? mask(validated.value) : validated.value, isSecret: row.isSecret, description: definition.description, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
}

export async function seedDefaultSettings(prisma: PrismaClient, domain: string) {
  const defaults: Array<[SettingKey, string]> = [['controlPlaneName', 'PocketCloud'], ['domain', domain], ['agentHeartbeatInterval', '10'], ['cpuThreshold', '85'], ['memoryThreshold', '85'], ['diskThreshold', '85'], ['backupEnabled', 'true'], ['backupRetentionDays', '30'], ['notificationsEnabled', 'false'], ['aiProvider', 'local']];
  for (const [key, value] of defaults) { const definition = SETTINGS[key]; await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value, category: definition.category, isSecret: definition.secret } }); }
}
