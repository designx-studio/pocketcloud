// Feature 3: Free-Tier Lifecycle Tracking
// Static provider policy table — reference data, not a DB model

export interface TierPolicy {
    kind: "hard_expiry" | "idle_reclamation" | "none";
    durationDays?: number;
    idleThresholdDays?: number;
    notes: string;
}

export const PROVIDER_TIER_POLICIES: Record<string, TierPolicy> = {
    "oracle:always_free": {
        kind: "idle_reclamation",
        idleThresholdDays: 7,
        notes: "Oracle reclaims Always Free compute instances judged idle. Track real CPU/network activity, not just heartbeat.",
    },
    "aws:free_tier": {
        kind: "hard_expiry",
        durationDays: 365,
        notes: "AWS free tier ends 12 months after account creation.",
    },
    "gcp:trial": {
        kind: "hard_expiry",
        durationDays: 90,
        notes: "GCP free trial credits expire after 90 days or when exhausted, whichever first.",
    },
    "azure:trial": {
        kind: "hard_expiry",
        durationDays: 30,
        notes: "Azure free trial expires after 30 days regardless of credit remaining.",
    },
    "hetzner:trial": {
        kind: "hard_expiry",
        durationDays: 30,
        notes: "Hetzner trial credits typically expire after 30 days.",
    },
    "digitalocean:credit": {
        kind: "hard_expiry",
        durationDays: 365,
        notes: "DigitalOcean promotional credits expire 1 year after issuance.",
    },
    "vultr:credit": {
        kind: "hard_expiry",
        durationDays: 365,
        notes: "Vultr promotional credits expire 1 year after issuance.",
    },
};

export function getTierPolicy(provider: string, tierType?: string): TierPolicy | null {
    if (!tierType) return null;
    const key = `${provider}:${tierType}`;
    return PROVIDER_TIER_POLICIES[key] ?? null;
}

export function daysBetween(from: Date, to: Date): number {
    return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}