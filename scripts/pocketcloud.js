#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Load .env
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args[0] !== 'restore') {
    console.error('Usage: pocketcloud restore <backup-file.json>');
    process.exit(1);
  }

  const filePath = path.resolve(args[1]);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Backup file not found at ${filePath}`);
    process.exit(1);
  }

  console.log(`[RESTORE] Reading backup archive from ${filePath}...`);
  let backup;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    backup = JSON.parse(raw);
  } catch (err) {
    console.error(`Error parsing backup file: ${err.message}`);
    process.exit(1);
  }

  console.log(`[RESTORE] Version: ${backup.version || 'unknown'} | Exported At: ${backup.exportedAt || 'unknown'}`);

  // 1. Restore Users
  if (Array.isArray(backup.users)) {
    console.log(`[RESTORE] Restoring ${backup.users.length} user(s)...`);
    for (const u of backup.users) {
      await prisma.user.upsert({
        where: { id: u.id },
        update: { email: u.email, role: u.role, passwordHash: u.passwordHash || '' },
        create: { id: u.id, email: u.email, role: u.role, passwordHash: u.passwordHash || '' }
      });
    }
  }

  // 2. Restore Servers & Agents
  if (Array.isArray(backup.servers)) {
    console.log(`[RESTORE] Restoring ${backup.servers.length} server(s)...`);
    for (const s of backup.servers) {
      await prisma.server.upsert({
        where: { id: s.id },
        update: {
          name: s.name,
          provider: s.provider,
          ipAddress: s.ipAddress,
          os: s.os,
          architecture: s.architecture,
          environment: s.environment,
          status: s.status
        },
        create: {
          id: s.id,
          name: s.name,
          provider: s.provider,
          ipAddress: s.ipAddress,
          os: s.os,
          architecture: s.architecture,
          environment: s.environment,
          status: s.status
        }
      });

      if (s.agent) {
        await prisma.agent.upsert({
          where: { id: s.agent.id },
          update: {
            serverId: s.agent.serverId,
            version: s.agent.version,
            credentialHash: s.agent.credentialHash,
            lastSeenAt: s.agent.lastSeenAt ? new Date(s.agent.lastSeenAt) : null
          },
          create: {
            id: s.agent.id,
            serverId: s.agent.serverId,
            version: s.agent.version,
            credentialHash: s.agent.credentialHash,
            lastSeenAt: s.agent.lastSeenAt ? new Date(s.agent.lastSeenAt) : null
          }
        });
      }
    }
  }

  // 3. Restore Blueprints & Versions
  if (Array.isArray(backup.blueprints)) {
    console.log(`[RESTORE] Restoring ${backup.blueprints.length} blueprint(s)...`);
    for (const b of backup.blueprints) {
      await prisma.blueprint.upsert({
        where: { id: b.id },
        update: {
          name: b.name,
          serverId: b.serverId,
          updatedAt: b.updatedAt ? new Date(b.updatedAt) : new Date()
        },
        create: {
          id: b.id,
          name: b.name,
          serverId: b.serverId,
          createdAt: b.createdAt ? new Date(b.createdAt) : new Date(),
          updatedAt: b.updatedAt ? new Date(b.updatedAt) : new Date()
        }
      });

      if (Array.isArray(b.versions)) {
        for (const v of b.versions) {
          await prisma.blueprintVersion.upsert({
            where: { id: v.id },
            update: {
              blueprintId: v.blueprintId,
              version: v.version,
              manifest: v.manifest,
              checksum: v.checksum
            },
            create: {
              id: v.id,
              blueprintId: v.blueprintId,
              version: v.version,
              manifest: v.manifest,
              checksum: v.checksum,
              createdAt: v.createdAt ? new Date(v.createdAt) : new Date()
            }
          });
        }
      }
    }
  }

  console.log('✔ Restore complete! All records successfully synchronized.');
}

main()
  .catch(err => {
    console.error(`Restore failed: ${err.message}`);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
