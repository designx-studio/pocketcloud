import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signAccess, verifyAccess, randomToken, hashToken } from '../apps/api/src/security.js';

describe('Security & Authentication Module', () => {
  it('hashes and verifies passwords using Argon2id', async () => {
    const password = 'SuperSecurePassword123!';
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, 'WrongPassword')).toBe(false);
  });

  it('signs and verifies JWT access tokens using jose', async () => {
    const userId = 'usr-test-123';
    const role = 'ADMIN';

    const token = await signAccess(userId, role);
    expect(token).toBeDefined();

    const decoded = await verifyAccess(token);
    expect(decoded.userId).toBe(userId);
    expect(decoded.role).toBe(role);
  });

  it('fails verification for a malformed stored hash instead of throwing', async () => {
    await expect(verifyPassword('not-an-argon2-hash', 'AnyPassword')).resolves.toBe(false);
  });

  it('generates random tokens and sha256 hashes', () => {
    const raw = randomToken();
    expect(raw).toBeDefined();
    expect(raw.length).toBeGreaterThan(20);

    const hash = hashToken(raw);
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64); // sha256 hex string length
  });
});
