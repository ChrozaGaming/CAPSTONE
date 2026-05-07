import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AdminClient } from './admin-client';
import type { SessionUser } from '@/lib/types';

/**
 * /admin — User Management page (manager only).
 * Server-side guard untuk role check (selain middleware).
 */
export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as any).role as string;
  if (role !== 'manager') {
    redirect('/dashboard');
  }

  const currentUser: SessionUser = {
    id:    (session.user as any).id,
    email: session.user.email!,
    name:  session.user.name || session.user.email!,
    role:  role as any,
  };

  return (
    <div className="space-y-1">
      <div className="mb-5">
        <h2 className="text-xl sm:text-2xl font-bold mb-1 text-text-primary">
          👥 Manage Users
        </h2>
        <p className="text-sm text-text-secondary">
          Tambah, edit, atau hapus user. Anda dapat memilih role:{' '}
          <span className="text-role-operator font-semibold">operator</span> ·{' '}
          <span className="text-role-supervisor font-semibold">supervisor</span> ·{' '}
          <span className="text-role-manager font-semibold">manager</span>.
        </p>
      </div>

      <AdminClient currentUser={currentUser} />
    </div>
  );
}
