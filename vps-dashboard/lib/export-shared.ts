/**
 * Shared utilities untuk export — type definitions + data shapers
 * yang dipakai oleh CSV, XLSX, dan PDF generators.
 */
import type { InspectionRow } from './types';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export type ExportMode = 'flat' | 'grouped';

/**
 * Variabel/kolom yang dapat di-include di export.
 * User pilih via checkbox di ExportMenu — default semua dipilih.
 */
export type ExportField =
  | 'id'
  | 'object_name'
  | 'dimension_mm'
  | 'width_mm'
  | 'confidence'
  | 'status'
  | 'timestamp';

export const ALL_FIELDS: ExportField[] = [
  'id', 'object_name', 'dimension_mm', 'width_mm',
  'confidence', 'status', 'timestamp',
];

export const FIELD_LABEL: Record<ExportField, string> = {
  id:           'ID',
  object_name:  'Objek',
  dimension_mm: 'Dimensi (mm)',
  width_mm:     'Lebar (mm)',
  confidence:   'Confidence',
  status:       'Status',
  timestamp:    'Waktu',
};

/** Format: "4 Mei 2026, 14.30" */
export function formatTimestampID(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(d);
}

/** Filename safe + timestamped: "inspeksi-flat-2026-05-04-1430" */
export function buildFilename(prefix: string, mode: ExportMode, format: ExportFormat): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${prefix}-${mode}-${stamp}.${format}`;
}

/* ─── DATA SHAPERS ───────────────────────────────────────────────────── */

export interface FlatRow {
  id:           number;
  object_name:  string;
  dimension_mm: number;
  width_mm:     string | number;
  confidence:   string | number;
  status:       string;
  timestamp:    string;
}

export interface GroupedRow {
  object_name: string;
  total:       number;
  good:        number;
  not_good:    number;
  good_pct:    string;
  ng_pct:      string;
  last_seen:   string;
}

/** Shape rows untuk flat mode (pilih fields). */
export function shapeFlat(rows: InspectionRow[], fields: ExportField[]): Record<string, any>[] {
  return rows.map(r => {
    const out: Record<string, any> = {};
    if (fields.includes('id'))           out[FIELD_LABEL.id]           = r.id;
    if (fields.includes('object_name'))  out[FIELD_LABEL.object_name]  = r.object_name || '—';
    if (fields.includes('dimension_mm')) out[FIELD_LABEL.dimension_mm] = Number(r.dimension_mm.toFixed(3));
    if (fields.includes('width_mm'))     out[FIELD_LABEL.width_mm]     = r.width_mm != null ? Number(r.width_mm.toFixed(3)) : '';
    if (fields.includes('confidence'))   out[FIELD_LABEL.confidence]   = r.confidence != null ? Number(r.confidence.toFixed(3)) : '';
    if (fields.includes('status'))       out[FIELD_LABEL.status]       = r.status;
    if (fields.includes('timestamp'))    out[FIELD_LABEL.timestamp]    = formatTimestampID(r.timestamp);
    return out;
  });
}

/** Shape rows untuk grouped mode (agregasi per object_name). */
export function shapeGrouped(rows: InspectionRow[]): GroupedRow[] {
  const map = new Map<string, { name: string; total: number; good: number; ng: number; lastSeen: number }>();
  for (const it of rows) {
    const name = (it.object_name && it.object_name.trim()) || '—';
    const ts = it.timestamp ? new Date(it.timestamp).getTime() : 0;
    const slot = map.get(name) || { name, total: 0, good: 0, ng: 0, lastSeen: 0 };
    slot.total++;
    if (it.status === 'GOOD') slot.good++;
    else if (it.status === 'NOT GOOD') slot.ng++;
    if (ts > slot.lastSeen) slot.lastSeen = ts;
    map.set(name, slot);
  }
  return Array.from(map.values())
    .sort((a, b) => b.total - a.total)
    .map(s => ({
      object_name: s.name,
      total:       s.total,
      good:        s.good,
      not_good:    s.ng,
      good_pct:    s.total > 0 ? ((s.good / s.total) * 100).toFixed(1) + '%' : '0%',
      ng_pct:      s.total > 0 ? ((s.ng   / s.total) * 100).toFixed(1) + '%' : '0%',
      last_seen:   s.lastSeen ? formatTimestampID(new Date(s.lastSeen)) : '—',
    }));
}

export const GROUPED_LABELS: Record<keyof GroupedRow, string> = {
  object_name: 'Objek',
  total:       'Total',
  good:        'GOOD',
  not_good:    'NOT GOOD',
  good_pct:    '% GOOD',
  ng_pct:      '% NOT GOOD',
  last_seen:   'Terakhir Terinspeksi',
};
