'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, X, FileText, FileSpreadsheet, FileType } from 'lucide-react';
import type { InspectionRow } from '@/lib/types';

type ExportFormat = 'csv' | 'xlsx' | 'pdf';
type ExportMode = 'flat' | 'grouped';
type FieldKey = 'id' | 'object_name' | 'dimension_mm' | 'width_mm' | 'confidence' | 'status' | 'timestamp';

const ALL_FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'id',           label: 'ID' },
  { key: 'object_name',  label: 'Nama Objek' },
  { key: 'dimension_mm', label: 'Dimensi (mm)' },
  { key: 'width_mm',     label: 'Lebar (mm)' },
  { key: 'confidence',   label: 'Confidence' },
  { key: 'status',       label: 'Status' },
  { key: 'timestamp',    label: 'Waktu' },
];

interface ExportMenuProps {
  rows: InspectionRow[];
  /** Bisa expose filter aktif dashboard biar default checked */
  initialSearch?: string;
  initialStatus?: 'all' | 'GOOD' | 'NOT GOOD';
}

type RangePreset = 'all' | 'today' | 'week' | 'month' | 'custom';

export function ExportMenu({ rows, initialSearch = '', initialStatus = 'all' }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [mode, setMode] = useState<ExportMode>('flat');
  const [fields, setFields] = useState<Set<FieldKey>>(new Set(ALL_FIELDS.map(f => f.key)));

  const [useCurrentFilters, setUseCurrentFilters] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<'all' | 'GOOD' | 'NOT GOOD'>(initialStatus);

  const [rangePreset, setRangePreset] = useState<RangePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [objectFilter, setObjectFilter] = useState<Set<string>>(new Set());
  const [showObjectPicker, setShowObjectPicker] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Compute date range from preset
  const dateRange = useMemo(() => {
    const now = new Date();
    if (rangePreset === 'all')   return { from: null, to: null };
    if (rangePreset === 'today') {
      const start = new Date(now); start.setHours(0,0,0,0);
      return { from: start.toISOString(), to: now.toISOString() };
    }
    if (rangePreset === 'week') {
      const start = new Date(now); start.setDate(now.getDate() - 7);
      return { from: start.toISOString(), to: now.toISOString() };
    }
    if (rangePreset === 'month') {
      const start = new Date(now); start.setDate(now.getDate() - 30);
      return { from: start.toISOString(), to: now.toISOString() };
    }
    // custom
    return {
      from: customFrom ? new Date(customFrom).toISOString() : null,
      to:   customTo   ? new Date(customTo).toISOString()   : null,
    };
  }, [rangePreset, customFrom, customTo]);

  // Estimate row count yang akan di-export (preview)
  const estimatedCount = useMemo(() => {
    const q = useCurrentFilters ? search.trim().toLowerCase() : '';
    const st = useCurrentFilters ? statusFilter : 'all';
    const fromMs = dateRange.from ? new Date(dateRange.from).getTime() : null;
    const toMs   = dateRange.to   ? new Date(dateRange.to).getTime()   : null;

    let arr = rows;
    if (q)         arr = arr.filter(r => (r.object_name || '').toLowerCase().includes(q));
    if (st !== 'all') arr = arr.filter(r => r.status === st);
    if (fromMs !== null) arr = arr.filter(r => new Date(r.timestamp).getTime() >= fromMs);
    if (toMs   !== null) arr = arr.filter(r => new Date(r.timestamp).getTime() <= toMs);
    if (objectFilter.size > 0) arr = arr.filter(r => objectFilter.has(r.object_name || '—'));
    if (mode === 'grouped') {
      const set = new Set(arr.map(r => r.object_name || '—'));
      return set.size;
    }
    return arr.length;
  }, [rows, useCurrentFilters, search, statusFilter, dateRange, objectFilter, mode]);

  // Distinct object names dari data
  const distinctObjects = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const n = r.object_name || '—';
      map.set(n, (map.get(n) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const toggleField = (k: FieldKey) => {
    setFields(s => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const toggleObject = (name: string) => {
    setObjectFilter(s => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const params = new URLSearchParams({ format, mode });
      if (mode === 'flat') {
        params.set('fields', Array.from(fields).join(','));
      }
      if (useCurrentFilters) {
        if (search.trim())     params.set('search', search.trim());
        if (statusFilter !== 'all') params.set('status', statusFilter);
      }
      if (dateRange.from) params.set('from', dateRange.from);
      if (dateRange.to)   params.set('to',   dateRange.to);
      if (objectFilter.size > 0) params.set('objects', Array.from(objectFilter).join(','));

      const r = await fetch(`/api/export?${params.toString()}`);
      if (!r.ok) {
        const t = await r.text();
        try { setErr(JSON.parse(t).message || 'Gagal export'); } catch { setErr('Gagal export'); }
        setBusy(false); return;
      }
      const blob = await r.blob();
      const cd = r.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m?.[1] || `export.${format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBusy(false);
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message || 'Network error');
      setBusy(false);
    }
  };

  const formatIcon = format === 'csv' ? <FileText size={14} />
    : format === 'xlsx' ? <FileSpreadsheet size={14} />
    : <FileType size={14} />;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 bg-accent-cyan hover:opacity-90 text-bg-primary font-bold uppercase tracking-wider text-xs py-2 px-4 rounded-md transition-opacity"
      >
        <Download size={14} /> Export Data
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <form
            onClick={e => e.stopPropagation()}
            onSubmit={submit}
            className="bg-bg-card border border-border rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-bg-card border-b border-border px-5 py-3 flex items-center justify-between z-10">
              <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
                <Download size={18} className="text-accent-cyan" /> Export Data Inspeksi
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Format */}
              <section>
                <h3 className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-2">Format File</h3>
                <div className="grid grid-cols-3 gap-2">
                  {(['csv','xlsx','pdf'] as ExportFormat[]).map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormat(f)}
                      className={`px-3 py-2.5 rounded-md border text-sm font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 ${
                        format === f
                          ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
                          : 'border-border bg-bg-card-hover text-text-secondary hover:border-border-light'
                      }`}
                    >
                      {f === 'csv'  && <FileText size={14} />}
                      {f === 'xlsx' && <FileSpreadsheet size={14} />}
                      {f === 'pdf'  && <FileType size={14} />}
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-muted mt-1.5">
                  {format === 'csv'  && 'CSV — paling simple, bisa dibuka di Excel/Sheets.'}
                  {format === 'xlsx' && 'Excel — native .xlsx dengan title row + auto-width.'}
                  {format === 'pdf'  && 'PDF — laporan formatted dengan header capstone + summary stats + tabel.'}
                </p>
              </section>

              {/* Mode */}
              <section>
                <h3 className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-2">Tipe Data</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setMode('flat')}
                    className={`px-3 py-2.5 rounded-md border text-sm font-semibold transition-colors text-left ${
                      mode === 'flat'
                        ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
                        : 'border-border bg-bg-card-hover text-text-secondary hover:border-border-light'
                    }`}>
                    📋 Flat (per inspeksi)
                    <p className="text-xs font-normal opacity-80 mt-0.5">Satu baris per pengukuran (default)</p>
                  </button>
                  <button type="button" onClick={() => setMode('grouped')}
                    className={`px-3 py-2.5 rounded-md border text-sm font-semibold transition-colors text-left ${
                      mode === 'grouped'
                        ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
                        : 'border-border bg-bg-card-hover text-text-secondary hover:border-border-light'
                    }`}>
                    📦 Klasifikasi (grouped)
                    <p className="text-xs font-normal opacity-80 mt-0.5">Agregasi per nama objek</p>
                  </button>
                </div>
              </section>

              {/* Range tanggal */}
              <section>
                <h3 className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-2">Range Tanggal</h3>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(['all','today','week','month','custom'] as RangePreset[]).map(p => (
                    <button key={p} type="button" onClick={() => setRangePreset(p)}
                      className={`px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wider transition-colors ${
                        rangePreset === p
                          ? 'bg-accent-cyan text-bg-primary'
                          : 'bg-bg-card-hover border border-border text-text-secondary hover:border-accent-cyan'
                      }`}>
                      {p === 'all' ? 'Semua' : p === 'today' ? 'Hari Ini' : p === 'week' ? '7 Hari' : p === 'month' ? '30 Hari' : 'Custom'}
                    </button>
                  ))}
                </div>
                {rangePreset === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-text-muted">Dari</label>
                      <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                        className="w-full bg-bg-primary border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-cyan" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-text-muted">Sampai</label>
                      <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)}
                        className="w-full bg-bg-primary border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-cyan" />
                    </div>
                  </div>
                )}
              </section>

              {/* Filter */}
              <section>
                <h3 className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-2">Filter</h3>
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input type="checkbox" checked={useCurrentFilters} onChange={e => setUseCurrentFilters(e.target.checked)}
                    className="accent-accent-cyan" />
                  <span className="text-sm text-text-secondary">
                    Sesuaikan dengan filter aktif di tabel
                    {(initialSearch || initialStatus !== 'all') && (
                      <span className="ml-1.5 text-xs text-text-muted font-mono">
                        ({initialSearch && `search="${initialSearch}"`}{initialSearch && initialStatus !== 'all' && ', '}{initialStatus !== 'all' && `status=${initialStatus}`})
                      </span>
                    )}
                  </span>
                </label>

                <div className="space-y-2">
                  {/* Object multi-select picker */}
                  <button type="button" onClick={() => setShowObjectPicker(s => !s)}
                    className="w-full flex items-center justify-between bg-bg-card-hover border border-border rounded-md px-3 py-2 text-sm text-text-secondary hover:border-accent-cyan transition-colors">
                    <span>
                      📦 Filter Objek:{' '}
                      <span className="text-accent-cyan font-semibold">
                        {objectFilter.size === 0 ? 'Semua' : `${objectFilter.size} dipilih`}
                      </span>
                    </span>
                    <span className="text-xs">{showObjectPicker ? '▲' : '▼'}</span>
                  </button>
                  {showObjectPicker && (
                    <div className="bg-bg-primary border border-border rounded-md p-2 max-h-48 overflow-y-auto">
                      <div className="flex gap-2 mb-2 pb-2 border-b border-border">
                        <button type="button" onClick={() => setObjectFilter(new Set())}
                          className="text-xs text-accent-cyan hover:underline">Hapus pilihan</button>
                        <button type="button" onClick={() => setObjectFilter(new Set(distinctObjects.map(([n]) => n)))}
                          className="text-xs text-accent-cyan hover:underline">Pilih semua</button>
                      </div>
                      {distinctObjects.length === 0 ? (
                        <p className="text-xs text-text-muted py-3 text-center">Belum ada objek</p>
                      ) : (
                        distinctObjects.map(([name, count]) => (
                          <label key={name} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-card-hover cursor-pointer">
                            <input type="checkbox" checked={objectFilter.has(name)} onChange={() => toggleObject(name)} className="accent-accent-cyan" />
                            <span className="text-sm text-text-primary flex-1">{name}</span>
                            <span className="text-xs text-text-muted font-mono">({count})</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* Variabel (only flat mode) */}
              {mode === 'flat' && (
                <section>
                  <h3 className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-2">
                    Variabel <span className="opacity-60">({fields.size}/{ALL_FIELDS.length} dipilih)</span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {ALL_FIELDS.map(f => (
                      <label key={f.key} className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors ${
                        fields.has(f.key) ? 'bg-accent-cyan/10 text-accent-cyan' : 'bg-bg-card-hover text-text-secondary hover:bg-bg-card-hover/80'
                      }`}>
                        <input type="checkbox" checked={fields.has(f.key)} onChange={() => toggleField(f.key)} className="accent-accent-cyan" />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {err && (
                <div className="bg-ng/10 border border-ng/40 rounded-md px-3 py-2 text-sm text-ng">
                  ❌ {err}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-bg-card border-t border-border px-5 py-3 flex items-center justify-between gap-3">
              <span className="text-xs text-text-muted">
                <span className="font-mono text-accent-cyan font-bold">{estimatedCount}</span> baris akan di-export
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)}
                  className="px-3 py-2 rounded-md border border-border text-text-secondary text-xs uppercase tracking-wider hover:border-text-primary transition-colors">
                  Batal
                </button>
                <button type="submit" disabled={busy || (mode === 'flat' && fields.size === 0)}
                  className="bg-accent-cyan hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-bg-primary font-bold uppercase tracking-wider text-xs py-2 px-5 rounded-md transition-opacity flex items-center gap-2">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : formatIcon}
                  {busy ? 'Generating…' : `Export ${format.toUpperCase()}`}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
