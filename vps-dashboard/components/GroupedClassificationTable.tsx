'use client';

import { useMemo, useState } from 'react';
import type { InspectionRow } from '@/lib/types';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, Package, LayoutGrid, List } from 'lucide-react';

interface GroupedClassificationTableProps {
  rows: InspectionRow[];
}

interface GroupedRow {
  name:     string;
  total:    number;
  good:     number;
  ng:       number;
  goodPct:  number;
  ngPct:    number;
  lastSeen: number;          // ms timestamp
  _searchName?: string;      // raw object_name (untuk flat mode search)
}

const PAGE_SIZE = 10;

type SortKey = 'name' | 'total' | 'good' | 'ng' | 'goodPct' | 'ngPct' | 'lastSeen';
type SortDir = 'asc' | 'desc';
type Mode    = 'grouped' | 'flat';

function formatRelative(ms: number) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 0 || !Number.isFinite(diff)) return '—';
  const sec = Math.floor(diff / 1000);
  if (sec < 60)  return `${sec} dtk lalu`;
  const min = Math.floor(sec / 60);
  if (min < 60)  return `${min} mnt lalu`;
  const hr  = Math.floor(min / 60);
  if (hr < 24)   return `${hr} jam lalu`;
  const day = Math.floor(hr / 24);
  if (day < 30)  return `${day} hari lalu`;
  const mo  = Math.floor(day / 30);
  return `${mo} bln lalu`;
}

/**
 * Klasifikasi per Objek — mirror local web Phase 1.
 *
 * Mode:
 *   - 'grouped' (default): agregasi per object_name (Total, GOOD, NOT GOOD,
 *     %GOOD, %NOT GOOD, lastSeen)
 *   - 'flat': satu baris per inspeksi (suffix #id), kontribusi 1/total
 *
 * Sort default: lastSeen desc → terbaru di atas (saat user pertama buka).
 */
export function GroupedClassificationTable({ rows }: GroupedClassificationTableProps) {
  const [mode, setMode] = useState<Mode>('grouped');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('lastSeen');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

  // Build base rows depending on mode
  const baseRows: GroupedRow[] = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    if (mode === 'grouped') {
      const map = new Map<string, GroupedRow>();
      for (const it of rows) {
        const name = it.object_name && it.object_name.trim() ? it.object_name : '—';
        const ts = it.timestamp ? new Date(it.timestamp).getTime() : 0;
        const slot = map.get(name) || {
          name, total: 0, good: 0, ng: 0, goodPct: 0, ngPct: 0, lastSeen: 0,
        };
        slot.total++;
        if (it.status === 'GOOD') slot.good++;
        else if (it.status === 'NOT GOOD') slot.ng++;
        if (ts > slot.lastSeen) slot.lastSeen = ts;
        map.set(name, slot);
      }
      return Array.from(map.values()).map(s => ({
        ...s,
        goodPct: s.total > 0 ? (s.good / s.total) * 100 : 0,
        ngPct:   s.total > 0 ? (s.ng   / s.total) * 100 : 0,
      }));
    }
    // flat mode — satu baris per inspeksi
    return rows.map(it => {
      const name = it.object_name && it.object_name.trim() ? it.object_name : '—';
      const isOK = it.status === 'GOOD';
      return {
        name: `${name} #${it.id}`,
        _searchName: name,
        total: 1,
        good:  isOK ? 1 : 0,
        ng:    isOK ? 0 : 1,
        goodPct: isOK ? 100 : 0,
        ngPct:   isOK ? 0   : 100,
        lastSeen: it.timestamp ? new Date(it.timestamp).getTime() : 0,
      };
    });
  }, [rows, mode]);

  // Filter (search by name)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = baseRows;
    if (q) {
      arr = arr.filter(r => {
        const target = (r._searchName || r.name || '').toLowerCase();
        return target.includes(q);
      });
    }
    // Sort
    arr = [...arr].sort((a, b) => {
      const av: any = (a as any)[sortKey];
      const bv: any = (b as any)[sortKey];
      const mul = sortDir === 'asc' ? 1 : -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
      return String(av ?? '').localeCompare(String(bv ?? '')) * mul;
    });
    return arr;
  }, [baseRows, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc'); }
    setPage(1);
  };

  const SortHeader = ({ label, k, alignRight = false }: { label: string; k: SortKey; alignRight?: boolean }) => {
    const active = sortKey === k;
    const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '↕';
    return (
      <th
        scope="col"
        className={`px-3 py-2 text-[11px] uppercase tracking-wider cursor-pointer select-none ${
          alignRight ? 'text-center' : 'text-left'
        } ${active ? 'text-accent-cyan' : 'text-text-muted hover:text-text-secondary'}`}
        onClick={() => toggleSort(k)}
      >
        {label} <span className="ml-0.5 opacity-60">{arrow}</span>
      </th>
    );
  };

  return (
    <div className="bg-bg-card border border-border rounded-lg p-5 mb-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xs uppercase tracking-wider text-text-muted font-semibold flex items-center gap-1.5">
          <Package size={14} /> Klasifikasi per Objek
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted font-mono">
            {filtered.length} baris
          </span>
          <button
            type="button"
            onClick={() => { setMode(m => m === 'grouped' ? 'flat' : 'grouped'); setPage(1); }}
            className="flex items-center gap-1.5 bg-bg-card-hover border border-border rounded-md px-3 py-1.5 text-xs uppercase tracking-wider font-semibold text-text-secondary hover:border-accent-cyan hover:text-accent-cyan transition-colors"
            title="Toggle mode antara Dikelompokkan dan Semua (flat per-inspeksi)"
          >
            {mode === 'grouped' ? <LayoutGrid size={12} /> : <List size={12} />}
            {mode === 'grouped' ? 'Mode: Dikelompokkan' : 'Mode: Semua'}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="🔍 Cari nama objek…"
            className="w-full bg-bg-card-hover border border-border rounded-md pl-8 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <SortHeader label="Objek"     k="name"     />
              <SortHeader label="Total"     k="total"    alignRight />
              <SortHeader label="GOOD"      k="good"     alignRight />
              <SortHeader label="NOT GOOD"  k="ng"       alignRight />
              <SortHeader label="% GOOD"    k="goodPct"  alignRight />
              <SortHeader label="% NG"      k="ngPct"    alignRight />
              <SortHeader label="Terakhir"  k="lastSeen" alignRight />
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-text-muted">
                  📭 Belum ada data untuk diklasifikasikan.
                </td>
              </tr>
            ) : (
              slice.map((r, idx) => (
                <tr key={r.name + idx} className="row-divider hover:bg-bg-card-hover transition-colors">
                  <td className="px-3 py-2 text-text-primary">{r.name}</td>
                  <td className="px-3 py-2 font-mono font-semibold text-center">{r.total}</td>
                  <td className="px-3 py-2 font-mono font-semibold text-ok text-center">{r.good}</td>
                  <td className="px-3 py-2 font-mono font-semibold text-ng text-center">{r.ng}</td>
                  <td className="px-3 py-2 font-mono font-semibold text-ok text-center">{r.goodPct.toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono font-semibold text-ng text-center">{r.ngPct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-text-muted text-xs text-center whitespace-nowrap">{formatRelative(r.lastSeen)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 pt-3 mt-2 border-t border-border">
          <button onClick={() => setPage(1)}                 disabled={safePage === 1}          className="page-btn-grouped"><ChevronsLeft  size={14} /></button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}    className="page-btn-grouped"><ChevronLeft   size={14} /></button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const startBtn = Math.max(1, Math.min(safePage - 2, totalPages - 4));
            const p = startBtn + i;
            if (p > totalPages) return null;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`page-btn-grouped ${p === safePage ? '!bg-accent-cyan !text-bg-primary !border-accent-cyan' : ''}`}
              >
                {p}
              </button>
            );
          })}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="page-btn-grouped"><ChevronRight  size={14} /></button>
          <button onClick={() => setPage(totalPages)}       disabled={safePage === totalPages}  className="page-btn-grouped"><ChevronsRight size={14} /></button>
          <span className="text-xs text-text-muted font-mono ml-2">
            Halaman {safePage} / {totalPages}
          </span>
        </div>
      )}

      <style jsx>{`
        .page-btn-grouped {
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
        .page-btn-grouped:hover:not(:disabled) {
          background: var(--accent-blue);
          color: white;
          border-color: var(--accent-blue);
        }
        .page-btn-grouped:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
