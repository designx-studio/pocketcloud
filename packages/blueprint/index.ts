import { z } from 'zod';

export const blueprintVersion = '1.1';

export const excludedKeys = new Set([
  'password',
  'secret',
  'token',
  'privateKey',
  'private_key',
  'sshKey',
  'ssh_key',
  'credential',
  'apiKey',
  'api_key',
  'auth_token',
  'jwt_secret',
  'encryption_key'
]);

export function sanitizeEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (excludedKeys.has(k) || /(password|secret|token|private.?key|credential|api.?key|passphrase|auth)/i.test(k)) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeEnvironment(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export const BlueprintManifestSchema = z.object({
  version: z.string().default('1.1'),
  blueprint: z.object({
    name: z.string().min(1).max(120),
    os: z.string().nullable().optional().transform(v => v || 'linux'),
    architecture: z.string().nullable().optional().transform(v => v || 'x86_64'),
    captured_from: z.string().nullable().optional().transform(v => v || 'vps'),
    captured_at: z.string().nullable().optional().transform(v => v || new Date().toISOString())
  }),
  system: z.object({
    packages: z.array(z.string()).default([]),
    services: z.array(z.string()).default([])
  }).default({ packages: [], services: [] }),
  containers: z.object({
    compose_file: z.string().optional(),
    services: z.array(z.record(z.unknown())).default([]),
    active_containers: z.array(z.string()).default([])
  }).default({ services: [], active_containers: [] }),
  ports: z.array(z.string()).default([])
});

export type BlueprintManifest = z.infer<typeof BlueprintManifestSchema>;

export function parseBlueprintManifest(data: unknown): BlueprintManifest {
  return BlueprintManifestSchema.parse(data);
}

export function validateCompatibility(manifest: BlueprintManifest, targetOs: string): { compatible: boolean; warnings: string[] } {
  const warnings: string[] = [];
  
  const manifestOsLower = manifest.blueprint.os.toLowerCase();
  const targetOsLower = targetOs.toLowerCase();

  if (manifestOsLower.includes('ubuntu') && !targetOsLower.includes('ubuntu')) {
    warnings.push(`Blueprint captured from ${manifest.blueprint.os}, target server running ${targetOs}. Package manager syntax may differ.`);
  }

  if (manifestOsLower.includes('debian') && !targetOsLower.includes('debian') && !targetOsLower.includes('ubuntu')) {
    warnings.push(`Blueprint captured from ${manifest.blueprint.os}, target server running ${targetOs}. Compatibility warning.`);
  }

  return {
    compatible: warnings.length === 0,
    warnings
  };
}
