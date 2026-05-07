/**
 * Shared helpers untuk API routes.
 * - requireRole(allowed) → return session atau throw 401/403
 * - apiError(message, status) → standar response shape
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { Role } from '@/lib/types';

export async function requireRole(allowed: Role[]) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 }) };
  }
  const role = (session.user as any).role as Role;
  if (!allowed.includes(role)) {
    return { error: NextResponse.json({ success: false, message: 'Forbidden — role insufficient' }, { status: 403 }) };
  }
  return { session, role };
}

export function apiError(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
