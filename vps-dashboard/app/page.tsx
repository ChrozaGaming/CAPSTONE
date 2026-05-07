import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

/**
 * Root page — redirect berdasar session:
 *   - Logged in → /dashboard
 *   - Tidak logged in → /login
 */
export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  redirect('/dashboard');
}
