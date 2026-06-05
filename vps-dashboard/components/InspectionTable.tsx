'use client';

import { useMemo, useState } from 'react';
import type { InspectionRow } from '@/lib/types';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search } from 'lucide-react';

interface InspectionTableProps {
  rows: InspectionRow[];
}

const PAGE_SIZE = 10;

type SortKey = 'id' | 'object_name' | 'dimension_mm' | 'status' | 'timestamp';
type SortDir = 'asc' | 'desc';

/**
 * Format waktu Indonesia: "4 Mei 2026, 14:30"
 * Pakai Intl.DateTimeFormat dengan locale id-ID supaya bulan disingkat
 * dalam bahasa Indonesia (Mei, Agu, Okt, Des, dst.).
 */
function formatTime(iso: string) {
  return new Intl.DateTimeFormat('id-ID', {
    day:    'numeric',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function StatusPill({ status }: { status: 'GOOD' | 'NOT GOOD' }) {
  const isOK = status === 'GOOD';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold ${
        isOK
          ? 'bg-ok/10 text-ok border border-ok/40'
          : 'bg-ng/10 text-ng border border-ng/40'
      }`}
    >
      {isOK ? '✔ GOOD' : '✘ NOT GOOD'}
    </span>
  );
}

/**
 * Tabel riwayat inspeksi dengan filter, sort, dan pagination.
 * Mirror local web Phase 1 (vanilla → React port).
 */
export function InspectionTable({ rows }: InspectionTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'GOOD' | 'NOT GOOD'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q && !(r.object_name || '').toLowerCase().includes(q)) return false;
      return true;
    });
    arr.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'timestamp') {
        return (new Date(av).getTime() - new Date(bv).getTime()) * mul;
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * mul;
      }
      return String(av ?? '').localeCompare(String(bv ?? '')) * mul;
    });
    return arr;
  }, [rows, search, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(k === 'object_name' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => {
    const active = sortKey === k;
    const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '↕';
    return (
      <th
        scope="col"
        className={`px-3 py-2 text-left text-[11px] uppercase tracking-wider cursor-pointer select-none ${
          active ? 'text-accent-cyan' : 'text-text-muted hover:text-text-secondary'
        }`}
        onClick={() => toggleSort(k)}
      >
        {label} <span className="ml-0.5 opacity-60">{arrow}</span>
      </th>
    );
  };

  return (
    <div className="bg-bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xs uppercase tracking-wider text-text-muted font-semibold flex items-center gap-1.5">
          <span>📋</span> Riwayat Inspeksi
        </h2>
        <span className="text-xs text-text-muted font-mono">
          {filtered.length} dari {rows.length} rekod
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Cari nama objek…"
            className="w-full bg-bg-card-hover border border-border rounded-md pl-8 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value as any); setPage(1); }}
          className="bg-bg-card-hover border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
        >
          <option value="all">Semua Status</option>
          <option value="GOOD">GOOD</option>
          <option value="NOT GOOD">NOT GOOD</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <SortHeader label="#ID"           k="id"          />
              <SortHeader label="Objek"         k="object_name" />
              <SortHeader label="Dimensi (mm)"  k="dimension_mm"/>
              <SortHeader label="Status"        k="status"      />
              <SortHeader label="Waktu"         k="timestamp"   />
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center text-text-muted">
                  📭 Tidak ada data yang cocok dengan filter.
                </td>
              </tr>
            ) : (
              slice.map(r => (
                <tr key={r.id} className="row-divider hover:bg-bg-card-hover transition-colors">
                  <td className="px-3 py-2 font-mono text-text-muted">#{r.id}</td>
                  <td className="px-3 py-2 text-text-primary">{r.object_name || '—'}</td>
                  <td className="px-3 py-2 font-mono">{r.dimension_mm.toFixed(3)}</td>
                  <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                  <td className="px-3 py-2 text-text-muted text-xs">{formatTime(r.timestamp)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 pt-3 mt-2 border-t border-border">
          <button onClick={() => setPage(1)}                disabled={safePage === 1}          className="page-btn"><ChevronsLeft  size={14} /></button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}    className="page-btn"><ChevronLeft   size={14} /></button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const startBtn = Math.max(1, Math.min(safePage - 2, totalPages - 4));
            const p = startBtn + i;
            if (p > totalPages) return null;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`page-btn ${p === safePage ? '!bg-accent-cyan !text-bg-primary !border-accent-cyan' : ''}`}
              >
                {p}
              </button>
            );
          })}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="page-btn"><ChevronRight  size={14} /></button>
          <button onClick={() => setPage(totalPages)}      disabled={safePage === totalPages}  className="page-btn"><ChevronsRight size={14} /></button>
          <span className="text-xs text-text-muted font-mono ml-2">
            Halaman {safePage} / {totalPages}
          </span>
          <span className="text-xs text-text-muted ml-2 hidden sm:inline">
            Ke halaman:
          </span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={safePage}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) setPage(Math.min(Math.max(1, v), totalPages));
            }}
            className="hidden sm:block w-14 bg-bg-card-hover border border-border rounded px-2 py-1 text-xs text-text-primary text-center font-mono focus:outline-none focus:border-accent-cyan"
          />
        </div>
      )}

      <style jsx>{`
        .page-btn {
          background: var(--bg-card-hover);
          border: 1px solid var(--border);
          color: var(--text-secondary);
          border-radius: 8px;
          padding: 4px 8px;
          font-family: var(--font-mono);
          font-weight: 600;
          font-size: 0.75rem;
          min-width: 28px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .page-btn:hover:not(:disabled) {
          background: var(--accent-blue);
          color: white;
          border-color: var(--accent-blue);
        }
        .page-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
