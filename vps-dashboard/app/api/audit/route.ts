/**
 * GET /api/audit?page=&pageSize=&action=&actor=
 *
 * Manager only. Return paginated list of audit logs (newest first).
 *
 * Query params:
 *   page     : 1-based (default 1)
 *   pageSize : default 25, max 100
 *   action   : filter by AuditAction (optional)
 *   actor    : filter by actorEmail contains (optional)
 *   from     : ISO datetime
 *   to       : ISO datetime
 */
import { prisma } from '@/lib/db';
import { requireRole, apiError, apiOk } from '@/lib/api-helpers';
import type { AuditAction } from '@prisma/client';

const VALID_ACTIONS: AuditAction[] = [
  'user_created', 'user_updated', 'user_deleted',
  'user_login', 'user_login_failed', 'user_logout',
  'data_exported', 'inspection_deleted',
];

export async function GET(req: Request) {
  const auth = await requireRole(['manager']);
  if (auth.error) return auth.error;

  const url = new URL(req.url);
  const page     = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25', 10)));
  const action   = url.searchParams.get('action') as AuditAction | null;
  const actor    = url.searchParams.get('actor');
  const fromIso  = url.searchParams.get('from');
  const toIso    = url.searchParams.get('to');

  const where: any = {};
  if (action && VALID_ACTIONS.includes(action)) where.action = action;
  if (actor && actor.trim()) {
    where.actorEmail = { contains: actor.trim(), mode: 'insensitive' };
  }
  if (fromIso || toIso) {
    where.createdAt = {};
    if (fromIso) where.createdAt.gte = new Date(fromIso);
    if (toIso)   where.createdAt.lte = new Date(toIso);
  }

  try {
    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return apiOk({
      items: items.map(it => ({
        ...it,
        createdAt: it.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e: any) {
    return apiError('DB query gagal: ' + (e.message || 'unknown'), 500);
  }
}
