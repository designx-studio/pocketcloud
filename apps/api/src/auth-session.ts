/**
 * Refresh-session issuance helpers shared by the register/login/refresh flows.
 */
import type { PrismaClient } from '@prisma/client';
import { hashToken, randomToken, signAccess } from './security.js';

export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
const REFRESH_TTL_MS = 30 * 864e5; // 30 days

interface SessionUser {
  id: string;
  email: string;
  role: string;
}

// Keep IP-only HTTP deployments usable while retaining Secure cookies behind HTTPS.
const isSecureRequest = (req: any) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  return forwardedProto === 'https' || req.protocol === 'https';
};

export const refreshCookieOptions = (req: any) => ({
  httpOnly: true,
  secure: isSecureRequest(req),
  sameSite: 'lax' as const,
  path: REFRESH_COOKIE_PATH
});

/** The user shape returned to clients — never exposes password hashes. */
export const publicUser = (user: SessionUser) => ({ id: user.id, email: user.email, role: user.role });

/**
 * Mint an access token and a rotated refresh cookie. When `sessionId` is given the
 * existing session row is rotated in place, otherwise a new session is created.
 */
export async function issueSession(
  prisma: PrismaClient,
  req: any,
  reply: any,
  user: SessionUser,
  sessionId?: string
): Promise<{ accessToken: string; user: ReturnType<typeof publicUser> }> {
  const refresh = randomToken();
  const data = {
    refreshHash: hashToken(refresh),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS)
  };

  if (sessionId) {
    await prisma.session.update({ where: { id: sessionId }, data });
  } else {
    await prisma.session.create({ data: { userId: user.id, ...data } });
  }

  reply.setCookie(REFRESH_COOKIE_NAME, refresh, refreshCookieOptions(req));

  return { accessToken: await signAccess(user.id, user.role), user: publicUser(user) };
}
