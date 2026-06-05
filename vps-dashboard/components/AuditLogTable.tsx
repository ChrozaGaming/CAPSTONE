'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

type AuditAction =
  | 'user_created' | 'user_updated' | 'user_deleted'
  | 'user_login' | 'user_login_failed' | 'user_logout'
  | 'data_exported' | 'inspection_deleted';

interface AuditRow {
  id:         string;
  action:     AuditAction;
  actorId:    string | null;
  actorEmail: string | null;
  actorRole:  string | null;
  targetType: string | null;
  targetId:   string | null;
  metadata:   any;
  ipAddress:  string | null;
  userAgent:  string | null;
  createdAt:  string;
}

const ACTION_LABEL: Record<AuditAction, { label: string; emoji: string; color: string }> = {
  user_created:       { label: 'User dibuat',       emoji: '👤', color: 'var(--ok-primary)' },
  user_updated:       { label: 'User diupdate',     emoji: '✏️', color: 'var(--accent-cyan)' },
  user_deleted:       { label: 'User dihapus',      emoji: '🗑️', color: 'var(--ng-primary)' },
  user_login:         { label: 'Login',             emoji: '🔓', color: 'var(--accent-cyan)' },
  user_login_failed:  { label: 'Login gagal',       emoji: '⚠️', color: 'var(--ng-primary)' },
  user_logout:        { label: 'Logout',            emoji: '🚪', color: 'var(--text-muted)' },
  data_exported:      { label: 'Data di-export',    emoji: '⬇️', color: 'var(--accent-blue)' },
  inspection_deleted: { label: 'Inspeksi dihapus',  emoji: '❌', color: 'var(--ng-primary)' },
};

const ALL_ACTIONS: AuditAction[] = Object.keys(ACTION_LABEL) as AuditAction[];

function formatTime(iso: string) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function summarizeMetadata(action: AuditAction, m: any): string {
  if (!m) return '—';
  try {
    if (action === 'user_created' || action === 'user_deleted') {
      return `${m.email || ''} (${m.role || '?'})`;
    }
    if (action === 'user_updated') {
      const c = m.changes || {};
      const parts: string[] = [];
      if (c.name) parts.push(`name: "${c.name.from}" → "${c.name.to}"`);
      if (c.role) parts.push(`role: ${c.role.from} → ${c.role.to}`);
      if (c.password) parts.push('password changed');
      return parts.join(', ') || `${m.email || ''}`;
    }
    if (action === 'user_login_failed') {
      return `Reason: ${m.reason || '?'}`;
    }
    if (action === 'data_exported') {
      const f = m.filters || {};
      const fp = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(',');
      return `${m.format?.toUpperCase() || ''} · ${m.mode || ''} · ${m.rowCount || 0} rows${fp ? ` · ${fp}` : ''}`;
    }
    return JSON.stringify(m);
  } catch {
    return '—';
  }
}

export function AuditLogTable() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<'all' | AuditAction>('all');
  const [actorFilter, setActorFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async (p = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(p),
        pageSize: String(pageSize),
      });
      if (actionFilter !== 'all') params.set('action', actionFilter);
      if (actorFilter.trim()) params.set('actor', actorFilter.trim());

      const r = await fetch(`/api/audit?${params.toString()}`);
      const j = await r.json();
      if (!r.ok || !j.success) {
        setError(j.message || 'Gagal load audit');
        setItems([]);
      } else {
        setItems(j.data.items);
        setTotalPages(j.data.totalPages);
        setTotal(j.data.total);
        setPage(j.data.page);
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    }
    setLoading(false);
  };

  useEffect(() => { load(1); }, [actionFilter]);
  useEffect(() => {
    const t = setTimeout(() => load(1), 300); // debounce actor filter
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorFilter]);

  return (
    <div className="bg-bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xs uppercase tracking-wider text-text-muted font-semibold flex items-center gap-1.5">
          <span>🕓</span> Audit Trail
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted font-mono">{total} entry</span>
          <button onClick={() => load(page)} className="p-1.5 rounded-md bg-bg-card-hover border border-border text-text-secondary hover:border-accent-cyan hover:text-accent-cyan transition-colors" title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value as any)}
          className="bg-bg-card-hover border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
        >
          <option value="all">Semua Action</option>
          {ALL_ACTIONS.map(a => (
            <option key={a} value={a}>
              {ACTION_LABEL[a].emoji} {ACTION_LABEL[a].label}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="🔍 Cari email actor…"
          value={actorFilter}
          onChange={e => setActorFilter(e.target.value)}
          className="flex-1 min-w-[200px] bg-bg-card-hover border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
        />
      </div>

      {error && (
        <div className="bg-ng/10 border border-ng/40 rounded-md px-3 py-2 mb-3 text-sm text-ng">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 size={18} className="animate-spin mr-2" /> Memuat…
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-text-muted">
          📭 Belum ada entry audit log.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-left text-[11px] uppercase tracking-wider text-text-muted">
                <th className="px-3 py-2">Waktu</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Detail</th>
                <th className="px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => {
                const cfg = ACTION_LABEL[it.action];
                return (
                  <tr key={it.id} className="row-divider hover:bg-bg-card-hover transition-colors">
                    <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{formatTime(it.createdAt)}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider"
                        style={{
                          color:  cfg.color,
                          border: `1px solid ${cfg.color}`,
                          backgroundColor: cfg.color + '10',
                        }}
                      >
                        <span>{cfg.emoji}</span>
                        <span>{cfg.label}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-mono text-text-secondary">{it.actorEmail || '—'}</div>
                      {it.actorRole && (
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: `var(--role-${it.actorRole}, var(--text-muted))` }}>
                          {it.actorRole}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary max-w-[400px] truncate" title={JSON.stringify(it.metadata)}>
                      {summarizeMetadata(it.action, it.metadata)}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted font-mono">{it.ipAddress || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-end items-center gap-2 pt-3 mt-2 border-t border-border">
          <button onClick={() => load(Math.max(1, page - 1))} disabled={page === 1}
            className="p-1.5 rounded bg-bg-card-hover border border-border text-text-secondary disabled:opacity-30 hover:border-accent-cyan transition-colors">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs text-text-muted font-mono">
            Halaman {page} / {totalPages}
          </span>
          <button onClick={() => load(Math.min(totalPages, page + 1))} disabled={page === totalPages}
            className="p-1.5 rounded bg-bg-card-hover border border-border text-text-secondary disabled:opacity-30 hover:border-accent-cyan transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
