import { describe, it, expect } from 'vitest';
import { bearerToken, buildAgentInstallCommand, resolvePublicOrigin, serializeMetric, serializeTask } from '../apps/api/src/http-utils.js';

describe('Shared HTTP utilities', () => {
  it('extracts bearer tokens and rejects malformed headers', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123');
    expect(bearerToken('Basic abc123')).toBeNull();
    expect(bearerToken('Bearer  ')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it('keeps IP and localhost deployments on http', () => {
    expect(resolvePublicOrigin('localhost:8080').origin).toBe('http://localhost:8080');
    expect(resolvePublicOrigin('203.0.113.9').origin).toBe('http://203.0.113.9');
  });

  it('builds the agent install command from the resolved origin', () => {
    expect(buildAgentInstallCommand('localhost:8080', 'tok-1')).toBe(
      'curl -fsSL http://localhost:8080/install-agent.sh | bash -s -- --token tok-1 --control-plane http://localhost:8080'
    );
  });

  it('deserializes task payloads stored as SQLite JSON strings', () => {
    expect(serializeTask({ id: 't1', payload: '{"service":"nginx"}' })).toEqual({ id: 't1', payload: { service: 'nginx' } });
    expect(serializeTask({ id: 't2', payload: { lines: 100 } }).payload).toEqual({ lines: 100 });
  });

  it('converts BigInt uptime into a JSON-serialisable number', () => {
    expect(serializeMetric({ cpu: 5, uptime: BigInt(86400) }).uptime).toBe(86400);
    expect(serializeMetric({ cpu: 5, uptime: null }).uptime).toBeNull();
  });
});
