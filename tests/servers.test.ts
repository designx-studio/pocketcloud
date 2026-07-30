import { describe, it, expect } from 'vitest';
import { randomToken, hashToken } from '../apps/api/src/security.js';

describe('Server Nodes & Bootstrap Tokens', () => {
  it('issues and validates bootstrap tokens for server pairing', () => {
    const rawToken = randomToken();
    const tokenHash = hashToken(rawToken);

    expect(rawToken).toBeDefined();
    expect(tokenHash).toBeDefined();
    expect(hashToken(rawToken)).toBe(tokenHash);
    expect(hashToken('invalid_token')).not.toBe(tokenHash);
  });
});
