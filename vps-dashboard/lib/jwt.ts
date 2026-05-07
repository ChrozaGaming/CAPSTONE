/**
 * JWT helpers — MIRROR exact algorithm dari CAPSTONE/server.js (Phase 2).
 *
 * Sign/verify HS256 dengan secret yang sama (NEXTAUTH_SECRET di sini =
 * JWT_SECRET di local server.js). Token yang issued oleh VPS Next.js
 * akan dapat di-verify oleh local server.js, dan sebaliknya.
 *
 * Claims yang konsisten:
 *   { sub, email, name, role, iat, exp }
 *
 * `role` ∈ ['operator', 'supervisor', 'manager']
 */
import jwt from 'jsonwebtoken';

export type Role = 'operator' | 'supervisor' | 'manager';

export interface CapstoneClaims {
  sub:   string;       // user id
  email: string;
  name:  string;
  role:  Role;
  iat?:  number;
  exp?:  number;
}

const SECRET = process.env.NEXTAUTH_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error('NEXTAUTH_SECRET harus diset di .env (min 32 karakter)');
}

export function signCapstoneToken(payload: Omit<CapstoneClaims, 'iat' | 'exp'>, expiresIn: string = '24h'): string {
  return jwt.sign(payload, SECRET as string, {
    algorithm: 'HS256',
    expiresIn: expiresIn as any,  // jsonwebtoken types are too narrow for runtime usage
  });
}

export function verifyCapstoneToken(token: string): { ok: true; claims: CapstoneClaims } | { ok: false; error: string } {
  try {
    const claims = jwt.verify(token, SECRET as string, { algorithms: ['HS256'] }) as CapstoneClaims;
    return { ok: true, claims };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'invalid token' };
  }
}
