'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      if (r?.error) {
        setError('Email atau password salah. Coba lagi.');
        setLoading(false);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Login gagal. Cek koneksi server.');
      setLoading(false);
    }
  };

  const fillDemo = (role: 'operator' | 'supervisor' | 'manager') => {
    setEmail(`${role}@capstone.dev`);
    setPassword(`${role}123`);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-xs uppercase tracking-wider text-text-muted mb-1.5 font-semibold">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          autoFocus
          className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20"
          placeholder="user@capstone.dev"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-xs uppercase tracking-wider text-text-muted mb-1.5 font-semibold">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20"
          placeholder="••••••••"
        />
      </div>

      {error && (
        <div className="bg-ng/10 border border-ng/40 rounded-md px-3 py-2 text-sm text-ng">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !email || !password}
        className="w-full bg-accent-cyan hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-bg-primary font-bold uppercase tracking-wider text-sm py-2.5 rounded-md transition-opacity flex items-center justify-center gap-2"
      >
        {loading && <Loader2 size={16} className="animate-spin" />}
        {loading ? 'Logging in…' : 'Login'}
      </button>

      {/* Quick fill demo buttons (dev only) */}
      <div className="pt-2 border-t border-border">
        <p className="text-[11px] uppercase tracking-wider text-text-muted mb-2 font-semibold">
          Quick Fill (Demo)
        </p>
        <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
          <button
            type="button"
            onClick={() => fillDemo('operator')}
            className="px-2 py-1 rounded bg-bg-card-hover border border-border text-role-operator hover:border-role-operator transition-colors"
          >
            operator
          </button>
          <button
            type="button"
            onClick={() => fillDemo('supervisor')}
            className="px-2 py-1 rounded bg-bg-card-hover border border-border text-role-supervisor hover:border-role-supervisor transition-colors"
          >
            supervisor
          </button>
          <button
            type="button"
            onClick={() => fillDemo('manager')}
            className="px-2 py-1 rounded bg-bg-card-hover border border-border text-role-manager hover:border-role-manager transition-colors"
          >
            manager
          </button>
        </div>
      </div>
    </form>
  );
}
