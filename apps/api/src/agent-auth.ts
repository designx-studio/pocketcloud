/**
 * Agent credential authentication helpers.
 * Agents authenticate with an opaque credential token rather than a user JWT.
 */
import type { PrismaClient } from '@prisma/client';
import { hashToken } from './security.js';
import { bearerToken } from './http-utils.js';

/** Look up the agent owning a credential token, including its server. */
export async function findAgentByCredential(prisma: PrismaClient, credential: string) {
  return prisma.agent.findUnique({
    where: { credentialHash: hashToken(credential) },
    include: { server: true }
  });
}

/**
 * Authenticate an agent request, replying with the appropriate 401 when the
 * credential is missing or unknown. Returns null once a reply has been sent.
 */
export async function authenticateAgent(prisma: PrismaClient, req: any, reply: any) {
  const credential = bearerToken(req.headers.authorization);
  if (!credential) {
    await reply.code(401).send({ error: 'missing_agent_token' });
    return null;
  }
  const agent = await findAgentByCredential(prisma, credential);
  if (!agent) {
    await reply.code(401).send({ error: 'invalid_agent_token' });
    return null;
  }
  return agent;
}

/** Reject agents acting on tasks that belong to a different server. */
export function agentOwnsServer(agent: { serverId: string } | undefined, serverId: string): boolean {
  return !agent || agent.serverId === serverId;
}
