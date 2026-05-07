/**
 * /api/users
 *   GET   → list semua users (manager only)
 *   POST  → create user baru (manager only)
 *
 * Body POST:
 *   { email, name, password, role: 'operator'|'supervisor'|'manager', edge_url? }
 */
import { z } from 'zod';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requireRole, apiError, apiOk } from '@/lib/api-helpers';
import { ROLES } from '@/lib/types';
import type { Role } from '@/lib/types';
import { logAudit, extractIp, extractUserAgent } from '@/lib/audit-log';

const CreateUserSchema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(6).max(200),
  role:     z.enum(['operator', 'supervisor', 'manager']),
  edge_url: z.string().url().optional().nullable(),
});

export async function GET() {
  const auth = await requireRole(['manager']);
  if (auth.error) return auth.error;

  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, name: true, role: true, edge_url: true, createdAt: true,
      },
    });
    return apiOk(users.map(u => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
    })));
  } catch (e: any) {
    return apiError('DB error: ' + (e.message || 'unknown'), 500);
  }
}

export async function POST(req: Request) {
  const auth = await requireRole(['manager']);
  if (auth.error) return auth.error;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return apiError('Body harus JSON valid', 400);
  }

  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(`Validation: ${parsed.error.issues.map(i => i.message).join(', ')}`, 400);
  }
  if (!ROLES.includes(parsed.data.role as Role)) {
    return apiError('Role harus salah satu: ' + ROLES.join(', '), 400);
  }

  // Check duplicate email
  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return apiError(`Email '${parsed.data.email}' sudah dipakai`, 409);
  }

  try {
    const hash = await bcrypt.hash(parsed.data.password, 10);
    const user = await prisma.user.create({
      data: {
        email:    parsed.data.email,
        name:     parsed.data.name,
        password: hash,
        role:     parsed.data.role,
        edge_url: parsed.data.edge_url ?? null,
      },
      select: { id: true, email: true, name: true, role: true, edge_url: true, createdAt: true },
    });

    // Audit log
    await logAudit({
      action:     'user_created',
      actorId:    (auth.session?.user as any)?.id,
      actorEmail: auth.session?.user?.email ?? null,
      actorRole:  auth.role,
      targetType: 'user',
      targetId:   user.id,
      metadata: {
        email: user.email,
        name:  user.name,
        role:  user.role,
      },
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
    });

    return apiOk({
      ...user,
      createdAt: user.createdAt.toISOString(),
    }, 201);
  } catch (e: any) {
    return apiError('Gagal membuat user: ' + (e.message || 'unknown'), 500);
  }
}
