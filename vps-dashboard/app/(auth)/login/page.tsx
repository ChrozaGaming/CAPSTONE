import { LoginForm } from '@/components/LoginForm';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export default async function LoginPage() {
  // Already logged in? Redirect ke dashboard.
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-bg-card border border-border rounded-lg p-8 shadow-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-accent-blue to-accent-cyan flex items-center justify-center text-2xl shadow-lg">
            🔬
          </div>
          <div>
            <h1 className="text-xl font-bold text-gradient">Capstone A3 Kelompok 2</h1>
            <p className="text-xs text-text-muted uppercase tracking-wider">Inspection Dashboard</p>
          </div>
        </div>

        <LoginForm />

        <p className="mt-6 text-[11px] text-text-muted text-center">
          Capstone A3 Kelompok 2 · Filkom Universitas Brawijaya
        </p>
      </div>
    </div>
  );
}
