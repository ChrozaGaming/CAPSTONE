/**
 * Audit log helper.
 * - logAudit(params) → tulis 1 row ke audit_logs.
 * - Best-effort: kegagalan log TIDAK boleh menggagalkan request user.
 *   Wrap di try/catch dan log error ke console saja.
 */
import { prisma } from '@/lib/db';
import type { AuditAction } from '@prisma/client';

export interface LogAuditParams {
  action:      AuditAction;
  actorId?:    string | null;
  actorEmail?: string | null;
  actorRole?:  string | null;
  targetType?: string | null;
  targetId?:   string | null;
  metadata?:   Record<string, any> | null;
  ipAddress?:  string | null;
  userAgent?:  string | null;
}

export async function logAudit(p: LogAuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action:     p.action,
        actorId:    p.actorId    ?? null,
        actorEmail: p.actorEmail ?? null,
        actorRole:  p.actorRole  ?? null,
        targetType: p.targetType ?? null,
        targetId:   p.targetId   ?? null,
        metadata:   (p.metadata as any) ?? undefined,
        ipAddress:  p.ipAddress  ?? null,
        userAgent:  p.userAgent  ?? null,
      },
    });
  } catch (e: any) {
    // Best-effort — jangan throw
    console.warn('[AUDIT] logAudit failed:', e?.message || e);
  }
}

/**
 * Extract IP address dari Next.js Request.
 * Cek X-Forwarded-For (saat behind reverse proxy Nginx) dan fallback ke
 * X-Real-IP atau remote address.
 */
export function extractIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || null;
}

export function extractUserAgent(req: Request): string | null {
  return req.headers.get('user-agent') || null;
}
