/**
 * Excel XLSX generator — pakai library `xlsx`.
 * Auto-fit column widths berdasarkan content length.
 */
import * as XLSX from 'xlsx';

interface XlsxOptions {
  sheetName?: string;
  /** Title row di atas data — bold, span semua kolom (kalau ada) */
  title?: string;
  /** Subtitle row (kalau ada) */
  subtitle?: string;
}

export function generateXLSX(rows: Record<string, any>[], opts: XlsxOptions = {}): Buffer {
  const sheetName = opts.sheetName || 'Data';

  // Buat worksheet dari array of objects
  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-width: hitung max length per column
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    const widths = headers.map(h => {
      const maxLen = Math.max(
        h.length,
        ...rows.map(r => String(r[h] ?? '').length),
      );
      return { wch: Math.min(Math.max(maxLen + 2, 8), 40) }; // clamp 8-40
    });
    (ws as any)['!cols'] = widths;
  }

  // Insert title rows kalau ada (push existing rows ke bawah)
  if (opts.title || opts.subtitle) {
    const headerRows: any[][] = [];
    if (opts.title) headerRows.push([opts.title]);
    if (opts.subtitle) headerRows.push([opts.subtitle]);
    headerRows.push([]); // blank separator
    XLSX.utils.sheet_add_aoa(ws, headerRows, { origin: 'A1' });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  return buf as Buffer;
}
