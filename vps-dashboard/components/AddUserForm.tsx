'use client';

import { useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { ROLES, type Role } from '@/lib/types';

interface AddUserFormProps {
  onCreated: () => void;
}

export function AddUserForm({ onCreated }: AddUserFormProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [edgeUrl, setEdgeUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const reset = () => {
    setEmail(''); setName(''); setPassword(''); setRole('operator'); setEdgeUrl(''); setMsg(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, name, password, role,
          edge_url: edgeUrl.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) {
        setMsg({ kind: 'err', text: j.message || 'Gagal' });
      } else {
        setMsg({ kind: 'ok', text: `User '${j.data.email}' berhasil dibuat sebagai ${j.data.role}.` });
        reset();
        onCreated();
      }
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message || 'Network error' });
    }
    setLoading(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-accent-cyan hover:opacity-90 text-bg-primary font-bold uppercase tracking-wider text-xs py-2 px-4 rounded-md transition-opacity flex items-center gap-2"
      >
        <UserPlus size={14} />
        Tambah User Baru
      </button>
    );
  }

  return (
    <div className="bg-bg-card border border-accent-cyan/40 rounded-lg p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm uppercase tracking-wider text-accent-cyan font-semibold flex items-center gap-1.5">
          <UserPlus size={14} /> Tambah User Baru
        </h3>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false); }}
          className="text-text-muted hover:text-text-primary text-xs"
        >
          ✕ Tutup
        </button>
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1 font-semibold">Email</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
            className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
            placeholder="user@capstone.dev" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1 font-semibold">Nama Lengkap</label>
          <input type="text" required value={name} onChange={e => setName(e.target.value)}
            className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
            placeholder="Nama lengkap user" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1 font-semibold">Password</label>
          <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
            className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
            placeholder="Min 6 karakter" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1 font-semibold">Role</label>
          <select value={role} onChange={e => setRole(e.target.value as Role)}
            className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-cyan">
            {ROLES.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        {role === 'operator' && (
          <div className="md:col-span-2">
            <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1 font-semibold">
              Edge URL <span className="opacity-60">(opsional, untuk redirect ke local kamera)</span>
            </label>
            <input type="url" value={edgeUrl} onChange={e => setEdgeUrl(e.target.value)}
              className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
              placeholder="http://localhost:3000 atau http://pi.local:3000" />
          </div>
        )}

        {msg && (
          <div className={`md:col-span-2 px-3 py-2 rounded-md text-sm ${
            msg.kind === 'ok' ? 'bg-ok/10 border border-ok/40 text-ok' : 'bg-ng/10 border border-ng/40 text-ng'
          }`}>
            {msg.text}
          </div>
        )}

        <div className="md:col-span-2 flex gap-2">
          <button type="submit" disabled={loading}
            className="bg-accent-cyan hover:opacity-90 disabled:opacity-50 text-bg-primary font-bold uppercase tracking-wider text-xs py-2 px-4 rounded-md transition-opacity flex items-center gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Membuat…' : 'Simpan User'}
          </button>
          <button type="button" onClick={reset}
            className="border border-border hover:border-text-secondary text-text-secondary text-xs uppercase tracking-wider py-2 px-4 rounded-md transition-colors">
            Reset
          </button>
        </div>
      </form>
    </div>
  );
}
