'use client';

import { AddUserForm } from '@/components/AddUserForm';
import { UserManagementTable } from '@/components/UserManagementTable';
import type { SessionUser } from '@/lib/types';

interface Props {
  currentUser: SessionUser;
}

/**
 * Client wrapper — connect AddUserForm → UserManagementTable refresh
 * via custom event 'users:refresh'.
 */
export function AdminClient({ currentUser }: Props) {
  const handleCreated = () => {
    window.dispatchEvent(new Event('users:refresh'));
  };

  return (
    <div className="space-y-3">
      <AddUserForm onCreated={handleCreated} />
      <UserManagementTable currentUser={currentUser} />
    </div>
  );
}
