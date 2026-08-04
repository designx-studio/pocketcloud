// Feature 9: Lite Deploy Mode
// One-command local bootstrap for minimal stack

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface LiteDeployOptions {
    cwd: string;
    services?: string[];
}

export async function liteDeploy(options: LiteDeployOptions) {
    const { cwd, services = ["postgresql-16", "redis-7", "nginx"] } = options;

    // 1. Detect docker-compose override
    const composeFiles = ["docker-compose.yml", "docker-compose.lite.yml"];
    const existing = composeFiles.filter((f) => {
        try {
            require("node:fs").accessSync(`${cwd}/${f}`);
            return true;
        } catch {
            return false;
        }
    });

    const composeArg = existing.map((f) => `-f ${f}`).join(" ");

    // 2. Pull + start selected services
    const serviceStr = services.join(" ");
    await execAsync(`docker compose ${composeArg} pull ${serviceStr}`, { cwd });
    await execAsync(`docker compose ${composeArg} up -d ${serviceStr}`, { cwd });

    // 3. Wait for health (basic TCP check)
    for (const svc of services) {
        const port = getServicePort(svc);
        if (port) {
            await waitForPort("localhost", port, 60000);
        }
    }

    return {
        services,
        composeFiles: existing,
        status: "running",
    };
}

function getServicePort(slug: string): number | null {
    const map: Record<string, number> = {
        "postgresql-16": 5432,
        "redis-7": 6379,
        "nginx": 80,
        "minio": 9000,
        "grafana": 3000,
        "prometheus": 9090,
    };
    return map[slug] ?? null;
}

async function waitForPort(host: string, port: number, timeout: number) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            await execAsync(`nc -z ${host} ${port}`, { timeout: 2000 });
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
    throw new Error(`Timeout waiting for ${host}:${port}`);
}

export async function liteStatus(cwd: string) {
    try {
        const { stdout } = await execAsync("docker compose ps --format json", { cwd });
        const lines = stdout.trim().split("\n").filter(Boolean);
        return lines.map((line) => JSON.parse(line));
    } catch {
        return [];
    }
}

export async function liteStop(cwd: string) {
    await execAsync("docker compose down", { cwd });
}