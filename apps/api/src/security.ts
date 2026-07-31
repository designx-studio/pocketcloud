import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import crypto from 'node:crypto';
import { config } from './config.js';
const jwtKey = new TextEncoder().encode(config.JWT_SECRET);
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
export async function signAccess(userId: string, role: string) { return new SignJWT({ sub: userId, role }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().setExpirationTime('15m').sign(jwtKey); }
export async function verifyAccess(token: string) { const result = await jwtVerify(token, jwtKey, { algorithms: ['HS256'] }); const userId = result.payload.sub; const role = result.payload.role; if (typeof userId !== 'string' || typeof role !== 'string') throw new Error('invalid_claims'); return { userId, role }; }
export function randomToken() { return crypto.randomBytes(32).toString('base64url'); }
export function hashToken(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
const encryptionKey = crypto.createHash('sha256').update(config.ENCRYPTION_KEY).digest();
export function encryptSecret(plain: string) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv); const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]); return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`; }
export function decryptSecret(payload: string) { const [ivRaw, tagRaw, dataRaw] = payload.split('.'); if (!ivRaw || !tagRaw || !dataRaw) throw new Error('invalid_secret_payload'); const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivRaw, 'base64url')); decipher.setAuthTag(Buffer.from(tagRaw, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8'); }
