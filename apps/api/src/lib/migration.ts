// Feature 4: Infrastructure Migration Planner
// Analyzes dependency graph and proposes migration steps

export interface MigrationStep {
    action: "migrate" | "restart" | "repoint_db" | "scale" | "delete";
    serverId: string;
    description: string;
    dependsOn: string[];
    risk: "low" | "medium" | "high";
}

export interface MigrationPlan {
    sourceServerId: string;
    targetServerId: string;
    steps: MigrationStep[];
    estimatedDowntime: string;
    rollbackPlan: string;
}

export function inferDependencies(
    servers: Array<{ id: string; role?: string; importance: string }>,
): MigrationStep[] {
    const steps: MigrationStep[] = [];
    const critical = servers.filter((s) => s.importance === "CRITICAL");
    const disposables = servers.filter((s) => s.importance === "DISPOSABLE");

    // Step 1: Migrate databases first
    const dbServers = critical.filter((s) => s.role === "database");
    for (const db of dbServers) {
        steps.push({
            action: "migrate",
            serverId: db.id,
            description: `Migrate database ${db.id}`,
            dependsOn: [],
            risk: "high",
        });
    }

    // Step 2: Migrate API servers (depend on DB)
    const apiServers = critical.filter((s) => s.role === "api");
    const dbIds = dbServers.map((s) => s.id);
    for (const api of apiServers) {
        steps.push({
            action: "repoint_db",
            serverId: api.id,
            description: `Update API ${api.id} connection string`,
            dependsOn: dbIds,
            risk: "medium",
        });
    }

    // Step 3: Migrate workers
    const workers = critical.filter((s) => s.role === "worker");
    for (const worker of workers) {
        steps.push({
            action: "migrate",
            serverId: worker.id,
            description: `Migrate worker ${worker.id}`,
            dependsOn: dbIds,
            risk: "medium",
        });
    }

    // Step 4: Delete disposable servers
    for (const disposable of disposables) {
        steps.push({
            action: "delete",
            serverId: disposable.id,
            description: `Delete disposable server ${disposable.id}`,
            dependsOn: steps
                .filter((s) => s.dependsOn.includes(disposable.id))
                .map((s) => s.serverId),
            risk: "low",
        });
    }

    return steps;
}

export function buildPlan(
    sourceId: string,
    targetId: string,
    servers: Array<{ id: string; role?: string; importance: string }>,
): MigrationPlan {
    const steps = inferDependencies(servers);
    return {
        sourceServerId: sourceId,
        targetServerId: targetId,
        steps,
        estimatedDowntime:
            steps.filter((s) => s.risk === "high").length > 0 ? "15-30 minutes" : "2-5 minutes",
        rollbackPlan: "Restore databases from last backup and revert DNS",
    };
}