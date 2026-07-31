#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args[0] !== 'restore') {
    console.error('Usage: pocketcloud restore <backup-file.json>');
    process.exitCode = 1;
    return;
  }
  const filePath = path.resolve(args[1]);
  if (!fs.existsSync(filePath)) throw new Error(`Backup file not found at ${filePath}`);
  let backup;
  try { backup = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (err) { throw new Error(`Error parsing backup file: ${err.message}`); }
  console.log(`[RESTORE] Version: ${backup.version || 'unknown'} | Exported At: ${backup.exportedAt || 'unknown'}`);

  // Password hashes are intentionally excluded from exports. Never create accounts with a blank password.
  if (Array.isArray(backup.users) && backup.users.length > 0) {
    console.warn(`[RESTORE] Skipping ${backup.users.length} user record(s): exports do not contain password hashes.`);
  }

  if (Array.isArray(backup.servers)) {
    for (const s of backup.servers) {
      await prisma.server.upsert({
        where: { id: s.id },
        update: { name: s.name, provider: s.provider, ipAddress: s.ipAddress, os: s.os, architecture: s.architecture, environment: s.environment, status: s.status },
        create: { id: s.id, name: s.name, provider: s.provider, ipAddress: s.ipAddress, os: s.os, architecture: s.architecture, environment: s.environment, status: s.status }
      });
      if (s.agent) {
        await prisma.agent.upsert({
          where: { id: s.agent.id },
          update: { serverId: s.agent.serverId, version: s.agent.version, credentialHash: s.agent.credentialHash, lastSeenAt: s.agent.lastSeenAt ? new Date(s.agent.lastSeenAt) : null },
          create: { id: s.agent.id, serverId: s.agent.serverId, version: s.agent.version, credentialHash: s.agent.credentialHash, lastSeenAt: s.agent.lastSeenAt ? new Date(s.agent.lastSeenAt) : null }
        });
      }
    }
    console.log(`[RESTORE] Restored ${backup.servers.length} server(s).`);
  }

  if (Array.isArray(backup.blueprints)) {
    for (const b of backup.blueprints) {
      await prisma.blueprint.upsert({
        where: { id: b.id },
        update: { name: b.name, serverId: b.serverId, updatedAt: b.updatedAt ? new Date(b.updatedAt) : new Date() },
        create: { id: b.id, name: b.name, serverId: b.serverId, createdAt: b.createdAt ? new Date(b.createdAt) : new Date(), updatedAt: b.updatedAt ? new Date(b.updatedAt) : new Date() }
      });
      for (const v of Array.isArray(b.versions) ? b.versions : []) {
        await prisma.blueprintVersion.upsert({
          where: { id: v.id },
          update: { blueprintId: v.blueprintId, version: v.version, manifest: v.manifest, checksum: v.checksum },
          create: { id: v.id, blueprintId: v.blueprintId, version: v.version, manifest: v.manifest, checksum: v.checksum, createdAt: v.createdAt ? new Date(v.createdAt) : new Date() }
        });
      }
    }
    console.log(`[RESTORE] Restored ${backup.blueprints.length} blueprint(s).`);
  }
  console.log('Restore complete. Existing accounts were preserved; create new credentials through the UI.');
}

main().catch((err) => { console.error(`Restore failed: ${err.message}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());