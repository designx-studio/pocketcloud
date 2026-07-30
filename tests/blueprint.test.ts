import { describe, it, expect } from 'vitest';
import { sanitizeEnvironment, parseBlueprintManifest, validateCompatibility } from '../packages/blueprint/index.js';

describe('Blueprint Engine Package', () => {
  it('sanitizes sensitive environment variables and secrets', () => {
    const rawEnv = {
      os: 'Ubuntu 24.04',
      docker_version: '26.1.0',
      db_password: 'super_secret_db_pass',
      jwt_secret: 'secret_token_value',
      sshKey: 'private_key_contents'
    };

    const sanitized = sanitizeEnvironment(rawEnv);
    expect(sanitized).toEqual({
      os: 'Ubuntu 24.04',
      docker_version: '26.1.0',
      db_password: '[REDACTED]',
      jwt_secret: '[REDACTED]',
      sshKey: '[REDACTED]'
    });
  });

  it('parses and validates blueprint manifest schemas', () => {
    const validManifest = {
      version: '1.1',
      blueprint: {
        name: 'web-api-stack',
        os: 'Ubuntu 24.04 LTS'
      },
      system: {
        packages: ['curl', 'nginx', 'htop'],
        services: ['nginx.service', 'docker.service']
      },
      ports: ['80/tcp', '443/tcp']
    };

    const parsed = parseBlueprintManifest(validManifest);
    expect(parsed.blueprint.name).toBe('web-api-stack');
    expect(parsed.system.packages).toContain('nginx');
  });

  it('validates blueprint compatibility against target server OS', () => {
    const manifest = parseBlueprintManifest({
      version: '1.1',
      blueprint: {
        name: 'test-stack',
        os: 'Ubuntu 24.04 LTS'
      }
    });

    const sameOsResult = validateCompatibility(manifest, 'Ubuntu 24.04 LTS');
    expect(sameOsResult.compatible).toBe(true);

    const diffOsResult = validateCompatibility(manifest, 'CentOS Stream 9');
    expect(diffOsResult.compatible).toBe(false);
    expect(diffOsResult.warnings.length).toBeGreaterThan(0);
  });
});
