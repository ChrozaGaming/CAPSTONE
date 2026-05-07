'use client';

import { useEffect, useState } from 'react';
import { Loader2, Trash2, Edit3, Save, X } from 'lucide-react';
import type { UserRow, Role, SessionUser } from '@/lib/types';
import { ROLES } from '@/lib/types';
import { RoleBadge } from './RoleBadge';

interface UserManagementTableProps {
  currentUser: SessionUser; // untuk cegah self-delete
}

export function UserManagementTable({ currentUser }: UserManagementTableProps) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; role: Role; password: string }>({
    name: '', role: 'operator', password: '',
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/users');
      const j = await r.json();
      if (!r.ok || !j.success) {
        setError(j.message || 'Gagal load users');
        setUsers([]);
      } else {
        setUsers(j.data);
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Expose reload supaya AddUserForm bisa trigger
  // (caller pass `key` reset / lift state)
  // Lihat usage di admin/page.tsx — pass ref? Untuk simplicity, expose globally lewat custom event:
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('users:refresh', handler);
    return () => window.removeEventListener('users:refresh', handler);
  }, []);

  const startEdit = (u: UserRow) => {
    setEditingId(u.id);
    setEditForm({ name: u.name || '', role: u.role, password: '' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: '', role: 'operator', password: '' });
  };

  const saveEdit = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const body: any = { name: editForm.name, role: editForm.role };
      if (editForm.password.trim()) body.password = editForm.password;
      const r = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.success) {
        setError(j.message || 'Gagal update');
      } else {
        cancelEdit();
        await load();
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    }
    setBusyId(null);
  };

  const deleteUser = async (u: UserRow) => {
    if (u.id === currentUser.id) {
      alert('Tidak bisa hapus akun sendiri.');
      return;
    }
    if (!window.confirm(`Hapus user '${u.email}'? Tindakan tidak dapat di-undo.`)) return;
    setBusyId(u.id);
    setError(null);
    try {
      const r = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || !j.success) {
        setError(j.message || 'Gagal hapus');
      } else {
        await load();
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    }
    setBusyId(null);
  };

  if (loading) {
    return (
      <div className="bg-bg-card border border-border rounded-lg p-8 flex items-center justify-center text-text-muted">
        <Loader2 size={18} className="animate-spin mr-2" /> Memuat users…
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xs uppercase tracking-wider text-text-muted font-semibold flex items-center gap-1.5">
          <span>👥</span> Daftar Users
        </h2>
        <span className="text-xs text-text-muted font-mono">{users.length} user</span>
      </div>

      {error && (
        <div className="bg-ng/10 border border-ng/40 rounded-md px-3 py-2 mb-3 text-sm text-ng">
          {error}
        </div>
      )}

      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr className="text-left text-[11px] uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Edge URL</th>
              <th className="px-3 py-2 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-text-muted">
                  Belum ada user. Tambahkan dengan tombol di atas.
                </td>
              </tr>
            ) : (
              users.map(u => {
                const isMe = u.id === currentUser.id;
                const isEditing = editingId === u.id;
                return (
                  <tr key={u.id} className="row-divider hover:bg-bg-card-hover transition-colors">
                    <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                      {u.email}
                      {isMe && <span className="ml-1.5 text-[10px] text-accent-cyan">(Anda)</span>}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input type="text" value={editForm.name}
                          onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                          className="w-full bg-bg-primary border border-border rounded px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent-cyan" />
                      ) : (
                        <span className="text-text-primary">{u.name || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select value={editForm.role}
                          onChange={e => setEditForm(f => ({ ...f, role: e.target.value as Role }))}
                          className="bg-bg-primary border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-cyan">
                          {ROLES.map(r => (<option key={r} value={r}>{r}</option>))}
                        </select>
                      ) : (
                        <RoleBadge role={u.role} size="sm" />
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-muted truncate max-w-[160px]">
                      {u.edge_url || '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="inline-flex gap-1">
                          <input type="password" placeholder="Password baru (opsional)"
                            value={editForm.password}
                            onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
                            className="bg-bg-primary border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-cyan w-40 hidden lg:inline-block" />
                          <button onClick={() => saveEdit(u.id)} disabled={busyId === u.id}
                            className="p-1.5 rounded bg-ok/10 border border-ok/40 text-ok hover:bg-ok/20 disabled:opacity-50">
                            {busyId === u.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          </button>
                          <button onClick={cancelEdit} disabled={busyId === u.id}
                            className="p-1.5 rounded bg-bg-card-hover border border-border text-text-secondary hover:border-text-primary disabled:opacity-50">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-1">
                          <button onClick={() => startEdit(u)}
                            className="p-1.5 rounded bg-bg-card-hover border border-border text-accent-cyan hover:border-accent-cyan transition-colors">
                            <Edit3 size={14} />
                          </button>
                          <button onClick={() => deleteUser(u)} disabled={isMe || busyId === u.id}
                            className="p-1.5 rounded bg-bg-card-hover border border-border text-ng hover:border-ng transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title={isMe ? 'Tidak bisa hapus akun sendiri' : 'Hapus user'}>
                            {busyId === u.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
