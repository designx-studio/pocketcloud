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
export function sanitizeEnvironment(input) {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
        if (excludedKeys.has(k) || /(password|secret|token|private.?key|credential|api.?key|passphrase|auth)/i.test(k)) {
            out[k] = '[REDACTED]';
        }
        else if (v && typeof v === 'object' && !Array.isArray(v)) {
            out[k] = sanitizeEnvironment(v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
export const BlueprintManifestSchema = z.object({
    version: z.string().default('1.1'),
    blueprint: z.object({
        name: z.string().min(1).max(120),
        os: z.string(),
        architecture: z.string().optional(),
        captured_from: z.string().optional(),
        captured_at: z.string().optional()
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
export function parseBlueprintManifest(data) {
    return BlueprintManifestSchema.parse(data);
}
export function validateCompatibility(manifest, targetOs) {
    const warnings = [];
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
