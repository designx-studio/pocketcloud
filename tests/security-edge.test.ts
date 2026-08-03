import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { decryptSecret, encryptSecret, hashPassword, hashToken, randomToken, signAccess, verifyAccess, verifyPassword } from '../apps/api/src/security.js';

const jwtKey = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-jwt-secret-change-this-in-production-min-32-chars');

describe('security edge cases', () => {
  describe('password hashing', () => {
    it('produces a salted argon2id hash that differs per call', async () => {
      const [first, second] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);

      expect(first.startsWith('$argon2id$')).toBe(true);
      expect(first).not.toBe(second);
      expect(await verifyPassword(second, 'same-password')).toBe(true);
    });

    it('rejects a malformed hash instead of accepting the password', async () => {
      await expect(verifyPassword('not-a-hash', 'password')).rejects.toThrow();
    });
  });

  describe('access tokens', () => {
    it('rejects a tampered token', async () => {
      const token = await signAccess('usr-1', 'ADMIN');
      const [header, payload, signature] = token.split('.');
      const forged = Buffer.from(JSON.stringify({ sub: 'usr-2', role: 'ADMIN' })).toString('base64url');

      await expect(verifyAccess(`${header}.${forged}.${signature}`)).rejects.toThrow();
      await expect(verifyAccess('not-a-token')).rejects.toThrow();
    });

    it('rejects an expired token', async () => {
      const expired = await new SignJWT({ sub: 'usr-1', role: 'ADMIN' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(jwtKey);

      await expect(verifyAccess(expired)).rejects.toThrow();
    });

    it('rejects a token signed with an unexpected algorithm', async () => {
      const unsecured = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'usr-1', role: 'ADMIN' })).toString('base64url')}.`;

      await expect(verifyAccess(unsecured)).rejects.toThrow();
    });

    it('rejects tokens missing string subject or role claims', async () => {
      const noRole = await new SignJWT({ sub: 'usr-1' }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().setExpirationTime('15m').sign(jwtKey);
      const numericRole = await new SignJWT({ sub: 'usr-1', role: 7 }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().setExpirationTime('15m').sign(jwtKey);
      const noSubject = await new SignJWT({ role: 'ADMIN' }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().setExpirationTime('15m').sign(jwtKey);

      await expect(verifyAccess(noRole)).rejects.toThrow('invalid_claims');
      await expect(verifyAccess(numericRole)).rejects.toThrow('invalid_claims');
      await expect(verifyAccess(noSubject)).rejects.toThrow('invalid_claims');
    });
  });

  describe('random tokens', () => {
    it('generates url-safe, unique tokens', () => {
      const tokens = new Set(Array.from({ length: 50 }, () => randomToken()));

      expect(tokens.size).toBe(50);
      for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('hashes deterministically without leaking the raw token', () => {
      const raw = randomToken();

      expect(hashToken(raw)).toBe(hashToken(raw));
      expect(hashToken(raw)).not.toContain(raw);
      expect(hashToken('')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('secret encryption', () => {
    it('produces a fresh iv for every encryption of the same plaintext', () => {
      const first = encryptSecret('rotate-me');
      const second = encryptSecret('rotate-me');

      expect(first).not.toBe(second);
      expect(decryptSecret(first)).toBe('rotate-me');
      expect(decryptSecret(second)).toBe('rotate-me');
    });

    it('round-trips unicode and long payloads', () => {
      expect(decryptSecret(encryptSecret('pässwörd-🔐'))).toBe('pässwörd-🔐');
      const long = 'k'.repeat(4096);
      expect(decryptSecret(encryptSecret(long))).toBe(long);
    });

    it('cannot round-trip an empty secret (empty ciphertext segment is unparseable)', () => {
      expect(() => decryptSecret(encryptSecret(''))).toThrow('invalid_secret_payload');
    });

    it('rejects malformed payloads', () => {
      expect(() => decryptSecret('')).toThrow('invalid_secret_payload');
      expect(() => decryptSecret('only.two')).toThrow('invalid_secret_payload');
    });

    it('rejects payloads whose ciphertext or auth tag was tampered with', () => {
      const [iv, tag, data] = encryptSecret('tamper-target').split('.');
      const flipped = Buffer.from(data!, 'base64url');
      flipped[0] ^= 0xff;

      expect(() => decryptSecret(`${iv}.${tag}.${flipped.toString('base64url')}`)).toThrow();
      expect(() => decryptSecret(`${iv}.${Buffer.alloc(16).toString('base64url')}.${data}`)).toThrow();
    });
  });
});
