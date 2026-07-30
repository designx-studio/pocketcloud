import argon2 from 'argon2'; import { SignJWT,jwtVerify } from 'jose'; import crypto from 'node:crypto'; import { config } from './config.js';
const jwtKey=new TextEncoder().encode(config.JWT_SECRET); export const hashPassword=(p:string)=>argon2.hash(p,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:4}); export const verifyPassword=(h:string,p:string)=>argon2.verify(h,p);
export async function signAccess(userId:string,role:string){return new SignJWT({sub:userId,role}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('15m').sign(jwtKey)}
export async function verifyAccess(token:string){const r=await jwtVerify(token,jwtKey); return {userId:String(r.payload.sub),role:String(r.payload.role)}}
export function randomToken(){return crypto.randomBytes(32).toString('base64url')} export function hashToken(v:string){return crypto.createHash('sha256').update(v).digest('hex')}
