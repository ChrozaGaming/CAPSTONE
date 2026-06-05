/**
 * CSV generator — RFC 4180 compliant escaping.
 * Tidak butuh dep, native string concat dengan BOM untuk Excel-compat.
 */

function escapeCsv(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Wrap dengan quotes kalau ada koma, newline, atau quote
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Generate CSV string dari array of objects.
 * Header otomatis dari keys row pertama.
 * Prepend dengan UTF-8 BOM supaya Excel buka tanpa garbled (terutama
 * karakter Indonesia: é, ô, dst).
 */
export function generateCSV(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '﻿';
  const headers = Object.keys(rows[0]);
  const lines: string[] = [];
  lines.push(headers.map(escapeCsv).join(','));
  for (const row of rows) {
    lines.push(headers.map(h => escapeCsv(row[h])).join(','));
  }
  // BOM ﻿ + CRLF (Excel-friendly)
  return '﻿' + lines.join('\r\n');
}

export function csvBuffer(rows: Record<string, any>[]): Buffer {
  return Buffer.from(generateCSV(rows), 'utf-8');
}
