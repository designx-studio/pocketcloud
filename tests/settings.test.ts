import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../apps/api/src/security.js';
import { validateSetting, SETTINGS } from '../apps/api/src/settings-service.js';

describe('runtime settings', () => {
  it('encrypts and decrypts secrets without storing plaintext', () => {
    const encrypted = encryptSecret('super-secret-value');
    expect(encrypted).not.toContain('super-secret-value');
    expect(decryptSecret(encrypted)).toBe('super-secret-value');
  });
  it('rejects unsupported settings and invalid thresholds', () => {
    expect(() => validateSetting('not-a-setting', 'x')).toThrow('unsupported_setting');
    expect(() => validateSetting('cpuThreshold', '101')).toThrow();
  });
  it('marks secret settings and exposes safe metadata', () => {
    expect(SETTINGS.aiApiKey.secret).toBe(true);
    expect(SETTINGS.controlPlaneName.secret).toBe(false);
  });
});
