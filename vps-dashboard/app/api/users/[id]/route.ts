/**
 * /api/users/[id]
 *   PATCH  → update field user (name, role, edge_url, optional password)
 *   DELETE → hapus user (cegah self-delete)
 */
import { z } from 'zod';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requireRole, apiError, apiOk } from '@/lib/api-helpers';
import { logAudit, extractIp, extractUserAgent } from '@/lib/audit-log';

const UpdateUserSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  role:     z.enum(['operator', 'supervisor', 'manager']).optional(),
  edge_url: z.string().url().nullable().optional(),
  password: z.string().min(6).max(200).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(['manager']);
  if (auth.error) return auth.error;

  const id = params.id;
  if (!id) return apiError('Missing id', 400);

  let body: any;
  try { body = await req.json(); } catch { return apiError('Body harus JSON valid'); }

  const parsed = UpdateUserSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(`Validation: ${parsed.error.issues.map(i => i.message).join(', ')}`, 400);
  }

  try {
    // Snapshot before — untuk diff metadata
    const before = await prisma.user.findUnique({ where: { id }, select: { email: true, name: true, role: true } });

    const data: any = {};
    if (parsed.data.name     !== undefined) data.name     = parsed.data.name;
    if (parsed.data.role     !== undefined) data.role     = parsed.data.role;
    if (parsed.data.edge_url !== undefined) data.edge_url = parsed.data.edge_url;
    if (parsed.data.password) {
      data.password = await bcrypt.hash(parsed.data.password, 10);
    }
    if (Object.keys(data).length === 0) {
      return apiError('Tidak ada field yang diubah', 400);
    }
    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, edge_url: true, createdAt: true },
    });

    // Build diff metadata (kolom yang berubah)
    const changes: Record<string, { from: any; to: any }> = {};
    if (data.name !== undefined && before?.name !== data.name) {
      changes.name = { from: before?.name, to: data.name };
    }
    if (data.role !== undefined && before?.role !== data.role) {
      changes.role = { from: before?.role, to: data.role };
    }
    if (data.password) {
      changes.password = { from: '***', to: '***' };
    }

    await logAudit({
      action:     'user_updated',
      actorId:    (auth.session?.user as any)?.id,
      actorEmail: auth.session?.user?.email ?? null,
      actorRole:  auth.role,
      targetType: 'user',
      targetId:   user.id,
      metadata:   { email: user.email, changes },
      ipAddress:  extractIp(req),
      userAgent:  extractUserAgent(req),
    });

    return apiOk({ ...user, createdAt: user.createdAt.toISOString() });
  } catch (e: any) {
    if (e.code === 'P2025') return apiError('User tidak ditemukan', 404);
    return apiError('Update gagal: ' + (e.message || 'unknown'), 500);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(['manager']);
  if (auth.error) return auth.error;

  const id = params.id;
  if (!id) return apiError('Missing id', 400);

  // Cegah self-delete (manager hapus akun sendiri)
  if (auth.session && (auth.session.user as any).id === id) {
    return apiError('Tidak boleh hapus akun sendiri', 400);
  }

  try {
    // Snapshot before delete (untuk audit metadata)
    const target = await prisma.user.findUnique({ where: { id }, select: { email: true, name: true, role: true } });

    await prisma.user.delete({ where: { id } });

    await logAudit({
      action:     'user_deleted',
      actorId:    (auth.session?.user as any)?.id,
      actorEmail: auth.session?.user?.email ?? null,
      actorRole:  auth.role,
      targetType: 'user',
      targetId:   id,
      metadata:   target ? { email: target.email, name: target.name, role: target.role } : { id },
      ipAddress:  extractIp(req),
      userAgent:  extractUserAgent(req),
    });

    return apiOk({ deleted: id });
  } catch (e: any) {
    if (e.code === 'P2025') return apiError('User tidak ditemukan', 404);
    return apiError('Delete gagal: ' + (e.message || 'unknown'), 500);
  }
}
