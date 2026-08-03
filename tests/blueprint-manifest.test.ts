import { describe, it, expect } from 'vitest';
import { blueprintVersion, excludedKeys, parseBlueprintManifest, sanitizeEnvironment, validateCompatibility } from '../packages/blueprint/index.ts';

describe('blueprint sanitizer', () => {
  it('redacts every excluded key verbatim', () => {
    const input = Object.fromEntries([...excludedKeys].map((key) => [key, 'sensitive']));

    const sanitized = sanitizeEnvironment(input);

    for (const key of excludedKeys) expect(sanitized[key]).toBe('[REDACTED]');
  });

  it('redacts by pattern regardless of casing or separators', () => {
    const sanitized = sanitizeEnvironment({
      DB_PASSWORD: 'x',
      'service.api-key': 'x',
      RefreshToken: 'x',
      ssh_private_key: 'x',
      passphrase: 'x',
      authorization: 'x',
      hostname: 'node-1'
    });

    expect(sanitized).toEqual({
      DB_PASSWORD: '[REDACTED]',
      'service.api-key': '[REDACTED]',
      RefreshToken: '[REDACTED]',
      ssh_private_key: '[REDACTED]',
      passphrase: '[REDACTED]',
      authorization: '[REDACTED]',
      hostname: 'node-1'
    });
  });

  it('recurses into nested objects while leaving arrays and primitives intact', () => {
    const sanitized = sanitizeEnvironment({
      services: { db: { host: 'db.internal', password: 'hunter2', nested: { api_key: 'k' } } },
      ports: ['80/tcp', '443/tcp'],
      replicas: 3,
      enabled: true,
      missing: null,
      undef: undefined
    });

    expect(sanitized).toEqual({
      services: { db: { host: 'db.internal', password: '[REDACTED]', nested: { api_key: '[REDACTED]' } } },
      ports: ['80/tcp', '443/tcp'],
      replicas: 3,
      enabled: true,
      missing: null,
      undef: undefined
    });
  });

  it('returns an empty object for empty input', () => {
    expect(sanitizeEnvironment({})).toEqual({});
  });
});

describe('blueprint manifest parsing', () => {
  it('fills defaults for omitted sections', () => {
    const parsed = parseBlueprintManifest({ blueprint: { name: 'minimal', os: 'Ubuntu 24.04 LTS' } });

    expect(parsed).toEqual({
      version: blueprintVersion,
      blueprint: { name: 'minimal', os: 'Ubuntu 24.04 LTS' },
      system: { packages: [], services: [] },
      containers: { services: [], active_containers: [] },
      ports: []
    });
  });

  it('keeps optional capture metadata and container details', () => {
    const parsed = parseBlueprintManifest({
      version: '1.1',
      blueprint: { name: 'full', os: 'Debian 12', architecture: 'aarch64', captured_from: 'srv-1', captured_at: '2024-01-01T00:00:00Z' },
      containers: { compose_file: 'docker-compose.yml', services: [{ name: 'api', image: 'pocketcloud/api' }], active_containers: ['api'] }
    });

    expect(parsed.blueprint.architecture).toBe('aarch64');
    expect(parsed.containers.compose_file).toBe('docker-compose.yml');
    expect(parsed.containers.services[0]).toEqual({ name: 'api', image: 'pocketcloud/api' });
  });

  it('rejects manifests with a missing, empty, or oversized name', () => {
    expect(() => parseBlueprintManifest({ blueprint: { os: 'Ubuntu 24.04 LTS' } })).toThrow();
    expect(() => parseBlueprintManifest({ blueprint: { name: '', os: 'Ubuntu 24.04 LTS' } })).toThrow();
    expect(() => parseBlueprintManifest({ blueprint: { name: 'a'.repeat(121), os: 'Ubuntu 24.04 LTS' } })).toThrow();
  });

  it('rejects wrongly typed sections and non-object input', () => {
    expect(() => parseBlueprintManifest({ blueprint: { name: 'x', os: 'Ubuntu' }, system: { packages: 'nginx' } })).toThrow();
    expect(() => parseBlueprintManifest({ blueprint: { name: 'x', os: 'Ubuntu' }, ports: [80] })).toThrow();
    expect(() => parseBlueprintManifest(null)).toThrow();
    expect(() => parseBlueprintManifest('manifest')).toThrow();
  });
});

describe('blueprint compatibility', () => {
  const manifestFor = (os: string) => parseBlueprintManifest({ blueprint: { name: 'stack', os } });

  it('treats matching distributions as compatible regardless of casing or version', () => {
    expect(validateCompatibility(manifestFor('Ubuntu 24.04 LTS'), 'ubuntu 22.04 lts')).toEqual({ compatible: true, warnings: [] });
    expect(validateCompatibility(manifestFor('Debian 12'), 'Debian 11')).toEqual({ compatible: true, warnings: [] });
  });

  it('treats Ubuntu as an acceptable target for Debian blueprints', () => {
    expect(validateCompatibility(manifestFor('Debian 12'), 'Ubuntu 24.04 LTS')).toEqual({ compatible: true, warnings: [] });
  });

  it('warns when the package manager family differs', () => {
    const result = validateCompatibility(manifestFor('Ubuntu 24.04 LTS'), 'CentOS Stream 9');

    expect(result.compatible).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Package manager syntax may differ');
  });

  it('warns for Debian blueprints on unrelated targets', () => {
    const result = validateCompatibility(manifestFor('Debian 12'), 'Fedora 40');

    expect(result.compatible).toBe(false);
    expect(result.warnings[0]).toContain('Compatibility warning');
  });

  it('reports no warnings when neither side is a known Debian derivative', () => {
    expect(validateCompatibility(manifestFor('Alpine 3.20'), 'Fedora 40')).toEqual({ compatible: true, warnings: [] });
  });
});
