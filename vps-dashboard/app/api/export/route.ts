/**
 * GET /api/export?format=&mode=&fields=&search=&status=&from=&to=
 *
 * Export data inspeksi ke CSV / XLSX / PDF dengan berbagai opsi.
 * Permission: supervisor + manager (operator forbidden).
 *
 * Query params:
 *   format     : 'csv' | 'xlsx' | 'pdf'         (required)
 *   mode       : 'flat' | 'grouped'             (required)
 *   fields     : comma-separated ExportField    (optional, default ALL_FIELDS)
 *   search     : filter object_name (case-insens) (optional)
 *   status     : 'GOOD' | 'NOT GOOD'             (optional)
 *   from       : ISO date string                 (optional)
 *   to         : ISO date string                 (optional)
 *   objects    : comma-separated object_name list (optional)
 *
 * Response: binary stream dengan Content-Disposition attachment.
 */
import { prisma } from '@/lib/db';
import { requireRole, apiError } from '@/lib/api-helpers';
import { logAudit, extractIp, extractUserAgent } from '@/lib/audit-log';
import { csvBuffer } from '@/lib/export-csv';
import { generateXLSX } from '@/lib/export-xlsx';
import { generatePDF } from '@/lib/export-pdf';
import {
  ALL_FIELDS, GROUPED_LABELS, buildFilename, formatTimestampID,
  shapeFlat, shapeGrouped,
  type ExportField, type ExportFormat, type ExportMode,
} from '@/lib/export-shared';
import type { InspectionRow } from '@/lib/types';

const VALID_FORMATS: ExportFormat[] = ['csv', 'xlsx', 'pdf'];
const VALID_MODES: ExportMode[]    = ['flat', 'grouped'];

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv:  'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf:  'application/pdf',
};

export async function GET(req: Request) {
  // ── Auth: supervisor + manager (operator forbidden)
  const auth = await requireRole(['supervisor', 'manager']);
  if (auth.error) return auth.error;

  // ── Parse query
  const url = new URL(req.url);
  const format = url.searchParams.get('format') as ExportFormat | null;
  const mode   = url.searchParams.get('mode')   as ExportMode | null;

  if (!format || !VALID_FORMATS.includes(format)) {
    return apiError('format harus salah satu: csv, xlsx, pdf');
  }
  if (!mode || !VALID_MODES.includes(mode)) {
    return apiError('mode harus salah satu: flat, grouped');
  }

  const fieldsParam = url.searchParams.get('fields');
  const fields: ExportField[] = fieldsParam
    ? (fieldsParam.split(',').filter(f => ALL_FIELDS.includes(f as ExportField)) as ExportField[])
    : [...ALL_FIELDS];

  const search    = url.searchParams.get('search') || '';
  const status    = url.searchParams.get('status'); // 'GOOD' | 'NOT GOOD' | null
  const fromIso   = url.searchParams.get('from');
  const toIso     = url.searchParams.get('to');
  const objects   = url.searchParams.get('objects'); // comma-separated names

  // ── Build Prisma where
  const where: any = {};
  if (status === 'GOOD' || status === 'NOT GOOD') where.status = status;
  if (search.trim()) where.object_name = { contains: search.trim(), mode: 'insensitive' };
  if (fromIso || toIso) {
    where.timestamp = {};
    if (fromIso) where.timestamp.gte = new Date(fromIso);
    if (toIso)   where.timestamp.lte = new Date(toIso);
  }
  if (objects) {
    const objList = objects.split(',').map(s => s.trim()).filter(Boolean);
    if (objList.length > 0) {
      where.object_name = { in: objList };
    }
  }

  // ── Query
  let dbRows: any[];
  try {
    dbRows = await prisma.inspection.findMany({
      where,
      orderBy: { timestamp: 'desc' },
    });
  } catch (e: any) {
    return apiError('DB query gagal: ' + (e.message || 'unknown'), 500);
  }

  // Coerce ke InspectionRow shape
  const rows: InspectionRow[] = dbRows.map(r => ({
    id:           r.id,
    object_name:  r.object_name,
    dimension_mm: r.dimension_mm,
    width_mm:     r.width_mm,
    confidence:   r.confidence,
    status:       r.status as 'GOOD' | 'NOT GOOD',
    timestamp:    r.timestamp.toISOString(),
  }));

  // ── Shape sesuai mode
  const shaped = mode === 'grouped' ? shapeGrouped(rows) : shapeFlat(rows, fields);

  // Map untuk PDF & XLSX — pakai label header Bahasa Indonesia
  const pretty: Record<string, any>[] = mode === 'grouped'
    ? (shaped as any[]).map(r => ({
        [GROUPED_LABELS.object_name]: r.object_name,
        [GROUPED_LABELS.total]:       r.total,
        [GROUPED_LABELS.good]:        r.good,
        [GROUPED_LABELS.not_good]:    r.not_good,
        [GROUPED_LABELS.good_pct]:    r.good_pct,
        [GROUPED_LABELS.ng_pct]:      r.ng_pct,
        [GROUPED_LABELS.last_seen]:   r.last_seen,
      }))
    : (shaped as Record<string, any>[]);

  // ── Generate file
  let buf: Buffer;
  let filename: string;
  const prefix = mode === 'grouped' ? 'klasifikasi' : 'inspeksi';
  filename = buildFilename(prefix, mode, format);

  try {
    if (format === 'csv') {
      buf = csvBuffer(pretty);
    } else if (format === 'xlsx') {
      buf = generateXLSX(pretty, {
        sheetName: mode === 'grouped' ? 'Klasifikasi per Objek' : 'Riwayat Inspeksi',
        title:     mode === 'grouped' ? 'Klasifikasi per Objek' : 'Riwayat Inspeksi Dimensi',
        subtitle:  `Capstone A3 Kelompok 2 · Diekspor ${formatTimestampID(new Date())}`,
      });
    } else {
      // PDF — sertakan summary stats + chart
      const total = rows.length;
      const good = rows.filter(r => r.status === 'GOOD').length;
      const ng = rows.filter(r => r.status === 'NOT GOOD').length;
      const summary = [
        { label: 'Total Inspeksi',  value: String(total),                                       tone: 'accent'  as const },
        { label: 'GOOD',            value: String(good),                                        tone: 'ok'      as const },
        { label: 'NOT GOOD',        value: String(ng),                                          tone: 'ng'      as const },
        { label: '% GOOD',          value: total > 0 ? ((good / total) * 100).toFixed(1) + '%' : '0%', tone: 'ok' as const },
        { label: '% NOT GOOD',      value: total > 0 ? ((ng   / total) * 100).toFixed(1) + '%' : '0%', tone: 'ng' as const },
      ];

      // Chart data — flat: pakai overall good/ng; grouped: top objects sorted by total
      let chart: any;
      if (mode === 'grouped') {
        // Hitung top objects with good/ng split
        const map = new Map<string, { name: string; good: number; ng: number }>();
        for (const r of rows) {
          const name = (r.object_name && r.object_name.trim()) || '—';
          const slot = map.get(name) || { name, good: 0, ng: 0 };
          if (r.status === 'GOOD') slot.good++;
          else if (r.status === 'NOT GOOD') slot.ng++;
          map.set(name, slot);
        }
        const topItems = Array.from(map.values())
          .sort((a, b) => (b.good + b.ng) - (a.good + a.ng));
        chart = { type: 'grouped-stacked', grouped: topItems };
      } else {
        chart = { type: 'flat-bar', flat: { good, notGood: ng } };
      }

      const filterParts: string[] = [];
      if (search.trim()) filterParts.push(`pencarian="${search.trim()}"`);
      if (status) filterParts.push(`status=${status}`);
      if (objects) filterParts.push(`objek=[${objects}]`);
      const rangeText = (fromIso || toIso)
        ? `${fromIso ? formatTimestampID(new Date(fromIso)) : '∞'} — ${toIso ? formatTimestampID(new Date(toIso)) : 'sekarang'}`
        : 'Semua waktu';

      buf = generatePDF(pretty, {
        title:    mode === 'grouped' ? 'Laporan Klasifikasi per Objek' : 'Laporan Riwayat Inspeksi',
        subtitle: 'Capstone A3 Kelompok 2 · Filkom Universitas Brawijaya',
        meta: {
          exportedBy: ((auth as any).session?.user?.name) || 'User',
          exportedAt: new Date(),
          rangeText,
          filterText: filterParts.length > 0 ? filterParts.join(', ') : 'Tidak ada filter',
        },
        summary,
        chart,
      });
    }
  } catch (e: any) {
    return apiError('Generate file gagal: ' + (e.message || 'unknown'), 500);
  }

  // ── Audit log (best-effort)
  await logAudit({
    action:     'data_exported',
    actorId:    (auth as any).session?.user?.id ?? null,
    actorEmail: (auth as any).session?.user?.email ?? null,
    actorRole:  (auth as any).role ?? null,
    targetType: 'export',
    targetId:   null,
    metadata: {
      format,
      mode,
      rowCount: rows.length,
      filename,
      filters: {
        search:  search || undefined,
        status:  status || undefined,
        objects: objects || undefined,
        from:    fromIso || undefined,
        to:      toIso || undefined,
      },
    },
    ipAddress: extractIp(req),
    userAgent: extractUserAgent(req),
  });

  // ── Response binary
  return new Response(buf as any, {
    status: 200,
    headers: {
      'Content-Type':        CONTENT_TYPE[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(buf.length),
      'Cache-Control':       'no-store',
    },
  });
}
