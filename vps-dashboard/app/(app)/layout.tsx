import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import type { SessionUser } from '@/lib/types';

/**
 * Authenticated app layout — server component.
 * Verifikasi session, lalu delegate UI ke AppShell client component
 * yang manage sidebar drawer state untuk mobile responsive.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const user: SessionUser = {
    id:    (session.user as any).id,
    email: session.user.email!,
    name:  session.user.name || session.user.email!,
    role:  (session.user as any).role,
  };

  return <AppShell user={user}>{children}</AppShell>;
}
