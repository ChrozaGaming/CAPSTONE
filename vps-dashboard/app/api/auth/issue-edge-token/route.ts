/**
 * /api/auth/issue-edge-token (operator only)
 *
 * Issue short-lived JWT (15 min) untuk redirect operator ke local edge
 * dashboard. Token signed dengan NEXTAUTH_SECRET yang sama dengan
 * JWT_SECRET di local server.js → local server.js dapat verify lewat
 * /api/auth/verify endpoint (Phase 2).
 *
 * Local dashboard akan baca ?token= dari URL, validate, lalu grant
 * akses ke live camera section sesuai role.
 */
import { auth } from '@/lib/auth';
import { signCapstoneToken } from '@/lib/jwt';
import { apiError, apiOk } from '@/lib/api-helpers';
import type { Role } from '@/lib/types';

export async function POST() {
  const session = await auth();
  if (!session?.user) return apiError('Unauthorized', 401);

  const role = (session.user as any).role as Role;
  if (role !== 'operator') {
    return apiError('Hanya operator yang dapat issue edge token', 403);
  }

  const token = signCapstoneToken({
    sub:   (session.user as any).id,
    email: session.user.email!,
    name:  session.user.name || session.user.email!,
    role,
  }, '15m'); // short-lived

  return apiOk({ token, expiresInSec: 15 * 60 });
}
