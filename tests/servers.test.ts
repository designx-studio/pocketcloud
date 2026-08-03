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

  it('generates agent installation command using APP_URL for Quick Start (http://IP)', () => {
    const token = 'test-token-123';
    const appUrl = 'http://192.168.1.100'.replace(/\/+$/, '');
    const cmd = `curl -fsSL ${appUrl}/install-agent.sh | bash -s -- --token ${token} --control-plane ${appUrl}`;
    expect(cmd).toBe('curl -fsSL http://192.168.1.100/install-agent.sh | bash -s -- --token test-token-123 --control-plane http://192.168.1.100');
  });

  it('generates agent installation command using APP_URL for Production (https://domain)', () => {
    const token = 'test-token-456';
    const appUrl = 'https://cloud.mycompany.com'.replace(/\/+$/, '');
    const cmd = `curl -fsSL ${appUrl}/install-agent.sh | bash -s -- --token ${token} --control-plane ${appUrl}`;
    expect(cmd).toBe('curl -fsSL https://cloud.mycompany.com/install-agent.sh | bash -s -- --token test-token-456 --control-plane https://cloud.mycompany.com');
  });

  it('detects request headers dynamically when APP_URL contains a placeholder (your-domain.com)', () => {
    const req = { headers: { host: '203.0.113.50:8080' } };
    const rawHost = req.headers.host;
    const hostPart = rawHost.split(':')[0] ?? '';
    const isIPOrLocalhost = hostPart === 'localhost' || /^[0-9.]+$/.test(hostPart);
    const scheme = isIPOrLocalhost ? 'http' : 'https';
    const appUrl = `${scheme}://${rawHost}`;
    const token = 'token-789';
    const cmd = `curl -fsSL ${appUrl}/install-agent.sh | bash -s -- --token ${token} --control-plane ${appUrl}`;
    expect(cmd).toBe('curl -fsSL http://203.0.113.50:8080/install-agent.sh | bash -s -- --token token-789 --control-plane http://203.0.113.50:8080');
  });
});
