import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AuditLogTable } from '@/components/AuditLogTable';

/**
 * /admin/audit — Audit Log page (manager only).
 * Server-side guard untuk role check (selain middleware).
 */
export default async function AuditPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as any).role as string;
  if (role !== 'manager') redirect('/dashboard');

  return (
    <div className="space-y-1">
      <div className="mb-5">
        <h2 className="text-xl sm:text-2xl font-bold mb-1 text-text-primary">
          🕓 Audit Log
        </h2>
        <p className="text-sm text-text-secondary">
          Histori aktivitas sistem: pembuatan/perubahan/penghapusan user, login (sukses & gagal), data export.
          Hanya manager yang dapat akses (governance + compliance).
        </p>
      </div>

      <AuditLogTable />
    </div>
  );
}
