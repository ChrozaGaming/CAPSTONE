/**
 * PDF generator — light theme, print-friendly.
 *
 * Layout:
 *   1. Header band (cyan accent) dengan title + subtitle + meta export info
 *   2. Summary stats card (5 KPI: Total, GOOD, NOT GOOD, %GOOD, %NG)
 *   3. Chart drawn natively dengan jsPDF primitives:
 *      - flat mode  → 2-bar vertical: GOOD vs NOT GOOD
 *      - grouped mode → horizontal stacked bar: top 8 objek by volume
 *   4. Tabel data via jspdf-autotable
 *   5. Footer dengan halaman + capstone credit
 *
 * Light theme colors (print-optimized contrast):
 *   - background          white #ffffff
 *   - header band         cyan-600 #0891b2
 *   - text primary        slate-800 #1e293b
 *   - text secondary      slate-600 #475569
 *   - text muted          slate-400 #94a3b8
 *   - border              slate-200 #e2e8f0
 *   - accent              cyan-600 #0891b2
 *   - ok / GOOD           emerald-600 #059669 (darker untuk print)
 *   - ng / NOT GOOD       red-600 #dc2626
 *   - alt-row (zebra)     slate-50 #f8fafc
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Light theme palette ────────────────────────────────────────────
type RGB = [number, number, number];
const C: Record<string, RGB> = {
  bg:        [255, 255, 255],
  headerBg:  [8, 145, 178],     // cyan-600
  textBold:  [15, 23, 42],      // slate-900
  textMain:  [30, 41, 59],      // slate-800
  textSec:   [71, 85, 105],     // slate-600
  textMuted: [148, 163, 184],   // slate-400
  border:    [226, 232, 240],   // slate-200
  accent:    [8, 145, 178],     // cyan-600
  ok:        [5, 150, 105],     // emerald-600
  ng:        [220, 38, 38],     // red-600
  zebra:     [248, 250, 252],   // slate-50
  cardBg:    [241, 245, 249],   // slate-100
};

export interface PdfChartData {
  type:    'flat-bar' | 'grouped-stacked';
  /** Untuk flat-bar: { good, notGood } */
  flat?: {
    good:    number;
    notGood: number;
  };
  /** Untuk grouped-stacked: top N objects (sudah sorted by total desc) */
  grouped?: { name: string; good: number; ng: number }[];
}

interface PdfOptions {
  title:    string;
  subtitle: string;
  meta?: {
    exportedBy?: string;
    exportedAt?: Date;
    rangeText?:  string;
    filterText?: string;
  };
  summary?: { label: string; value: string; tone?: 'default' | 'ok' | 'ng' | 'accent' }[];
  chart?: PdfChartData;
}

function fmtID(d: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

/* ─── Native chart drawers ────────────────────────────────────────── */

/**
 * Vertical 2-bar chart: GOOD (hijau) vs NOT GOOD (merah).
 * Cocok untuk flat mode summary distribution.
 */
function drawFlatBar(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  good: number, notGood: number,
) {
  const total = good + notGood;
  if (total === 0) return;

  // Frame background
  doc.setFillColor(...C.cardBg);
  doc.roundedRect(x, y, w, h, 4, 4, 'F');

  // Title
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.textBold);
  doc.text('Distribusi Hasil Inspeksi', x + 12, y + 16);

  // Plot area
  const padTop = 30;
  const padBottom = 30;
  const padLeft = 12;
  const padRight = 12;
  const plotX = x + padLeft;
  const plotY = y + padTop;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  // Y axis baseline
  const baseline = plotY + plotH;
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.5);
  doc.line(plotX, baseline, plotX + plotW, baseline);

  // 2 bars centered
  const barW = Math.min(60, plotW / 4);
  const gap  = barW * 0.6;
  const groupW = barW * 2 + gap;
  const startX = plotX + (plotW - groupW) / 2;

  const max = Math.max(good, notGood, 1);
  const goodH = (good / max) * plotH * 0.85;
  const ngH   = (notGood / max) * plotH * 0.85;

  // GOOD bar
  doc.setFillColor(...C.ok);
  doc.roundedRect(startX, baseline - goodH, barW, goodH, 2, 2, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.ok);
  doc.text(String(good), startX + barW / 2, baseline - goodH - 6, { align: 'center' });
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.textSec);
  doc.text('GOOD', startX + barW / 2, baseline + 12, { align: 'center' });
  if (total > 0) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.ok);
    doc.text(`${((good / total) * 100).toFixed(1)}%`, startX + barW / 2, baseline + 22, { align: 'center' });
  }

  // NOT GOOD bar
  const ngX = startX + barW + gap;
  doc.setFillColor(...C.ng);
  doc.roundedRect(ngX, baseline - ngH, barW, ngH, 2, 2, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.ng);
  doc.text(String(notGood), ngX + barW / 2, baseline - ngH - 6, { align: 'center' });
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.textSec);
  doc.text('NOT GOOD', ngX + barW / 2, baseline + 12, { align: 'center' });
  if (total > 0) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.ng);
    doc.text(`${((notGood / total) * 100).toFixed(1)}%`, ngX + barW / 2, baseline + 22, { align: 'center' });
  }
}

/**
 * Horizontal stacked bar chart: top N objek dengan distribusi GOOD vs NG.
 * Cocok untuk grouped mode.
 */
function drawGroupedStacked(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  items: { name: string; good: number; ng: number }[],
) {
  if (items.length === 0) return;
  const TOP_N = 8;
  const sliced = items.slice(0, TOP_N);

  // Card background
  doc.setFillColor(...C.cardBg);
  doc.roundedRect(x, y, w, h, 4, 4, 'F');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.textBold);
  doc.text(`Top ${sliced.length} Objek (volume)`, x + 12, y + 16);

  // Legend
  doc.setFontSize(7);
  doc.setFillColor(...C.ok);
  doc.rect(x + w - 110, y + 10, 8, 8, 'F');
  doc.setTextColor(...C.textSec);
  doc.setFont('helvetica', 'normal');
  doc.text('GOOD', x + w - 100, y + 16);
  doc.setFillColor(...C.ng);
  doc.rect(x + w - 60, y + 10, 8, 8, 'F');
  doc.text('NOT GOOD', x + w - 50, y + 16);

  // Layout
  const padTop = 28;
  const padBottom = 8;
  const labelW = 80;       // label objek di kiri
  const countW = 30;       // total count di kanan
  const barLeft = x + 12 + labelW + 6;
  const barRight = x + w - countW - 12;
  const barW = barRight - barLeft;
  const rowSpace = (h - padTop - padBottom) / sliced.length;
  const barH = Math.min(rowSpace * 0.55, 16);

  const maxTotal = Math.max(...sliced.map(it => it.good + it.ng), 1);

  sliced.forEach((it, i) => {
    const total = it.good + it.ng;
    const rowY = y + padTop + i * rowSpace;
    const barY = rowY + (rowSpace - barH) / 2;

    // Label kiri (truncate kalau panjang)
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.textMain);
    let labelText = it.name;
    while (doc.getTextWidth(labelText) > labelW - 4 && labelText.length > 3) {
      labelText = labelText.slice(0, -2) + '…';
    }
    doc.text(labelText, x + 12, barY + barH / 2 + 3);

    // Stacked bar
    const totalLen = (total / maxTotal) * barW;
    const goodLen = total > 0 ? (it.good / total) * totalLen : 0;
    const ngLen   = total > 0 ? (it.ng   / total) * totalLen : 0;

    if (goodLen > 0) {
      doc.setFillColor(...C.ok);
      doc.rect(barLeft, barY, goodLen, barH, 'F');
    }
    if (ngLen > 0) {
      doc.setFillColor(...C.ng);
      doc.rect(barLeft + goodLen, barY, ngLen, barH, 'F');
    }

    // Inline counts (di dalam bar, kalau cukup ruang)
    if (goodLen > 18) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(String(it.good), barLeft + 4, barY + barH / 2 + 2.5);
    }
    if (ngLen > 18) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(String(it.ng), barLeft + goodLen + 4, barY + barH / 2 + 2.5);
    }

    // Total count di kanan
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.textBold);
    doc.text(String(total), x + w - 8, barY + barH / 2 + 3, { align: 'right' });
  });
}

/* ─── Main generator ──────────────────────────────────────────────── */

export function generatePDF(rows: Record<string, any>[], opts: PdfOptions): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ── Background putih (eksplisit fill, jaga-jaga viewer aneh)
  doc.setFillColor(...C.bg);
  doc.rect(0, 0, pageW, pageH, 'F');

  // ── Header band (top accent strip)
  doc.setFillColor(...C.headerBg);
  doc.rect(0, 0, pageW, 56, 'F');

  // Title (white-on-cyan)
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.text(opts.title, 30, 28);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(220, 240, 250);
  doc.text(opts.subtitle, 30, 44);

  // Right side meta
  doc.setFontSize(8);
  doc.text(`Diekspor: ${fmtID(opts.meta?.exportedAt || new Date())}`, pageW - 30, 28, { align: 'right' });
  if (opts.meta?.exportedBy) {
    doc.text(`Oleh: ${opts.meta.exportedBy}`, pageW - 30, 44, { align: 'right' });
  }

  let y = 72;

  // ── Meta info row (range, filter)
  doc.setTextColor(...C.textSec);
  doc.setFontSize(8);
  if (opts.meta?.rangeText) {
    doc.setFont('helvetica', 'bold');
    doc.text('Range:', 30, y);
    doc.setFont('helvetica', 'normal');
    doc.text(opts.meta.rangeText, 70, y);
    y += 12;
  }
  if (opts.meta?.filterText) {
    doc.setFont('helvetica', 'bold');
    doc.text('Filter:', 30, y);
    doc.setFont('helvetica', 'normal');
    doc.text(opts.meta.filterText, 70, y);
    y += 12;
  }

  y += 6;

  // ── Summary stats card
  if (opts.summary && opts.summary.length > 0) {
    const cardH = 48;
    const cardX = 30;
    const cardW = pageW - 60;
    doc.setFillColor(...C.cardBg);
    doc.roundedRect(cardX, y, cardW, cardH, 4, 4, 'F');

    const colW = cardW / opts.summary.length;
    opts.summary.forEach((item, i) => {
      const cx = cardX + i * colW + colW / 2;

      // separator vertical line antara columns
      if (i > 0) {
        doc.setDrawColor(...C.border);
        doc.setLineWidth(0.5);
        doc.line(cardX + i * colW, y + 8, cardX + i * colW, y + cardH - 8);
      }

      // Label
      doc.setFontSize(7);
      doc.setTextColor(...C.textSec);
      doc.setFont('helvetica', 'normal');
      doc.text(item.label, cx, y + 14, { align: 'center' });

      // Value (large, colored by tone)
      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      const tone = item.tone || 'default';
      const color =
        tone === 'ok'     ? C.ok :
        tone === 'ng'     ? C.ng :
        tone === 'accent' ? C.accent :
                            C.textBold;
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text(item.value, cx, y + 36, { align: 'center' });
    });

    y += cardH + 14;
  }

  // ── Chart
  if (opts.chart) {
    const chartH = 130;
    const chartW = pageW - 60;
    const chartX = 30;

    if (opts.chart.type === 'flat-bar' && opts.chart.flat) {
      drawFlatBar(doc, chartX, y, chartW, chartH, opts.chart.flat.good, opts.chart.flat.notGood);
    } else if (opts.chart.type === 'grouped-stacked' && opts.chart.grouped) {
      drawGroupedStacked(doc, chartX, y, chartW, chartH, opts.chart.grouped);
    }
    y += chartH + 14;
  }

  // ── Table title
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.textBold);
  doc.text('Data Detail', 30, y);
  y += 8;

  // ── Table
  if (rows.length === 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...C.textMuted);
    doc.text('Tidak ada data untuk di-export.', pageW / 2, y + 30, { align: 'center' });
  } else {
    const headers = Object.keys(rows[0]);
    const body = rows.map(r => headers.map(h => String(r[h] ?? '')));

    autoTable(doc, {
      startY: y,
      head: [headers],
      body,
      theme: 'plain',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 5,
        textColor: [...C.textMain],
        lineColor: [...C.border],
        lineWidth: 0.4,
      },
      headStyles: {
        fillColor: [...C.headerBg],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'left',
        fontSize: 8.5,
        cellPadding: 6,
      },
      bodyStyles: {
        fillColor: [255, 255, 255],
      },
      alternateRowStyles: {
        fillColor: [...C.zebra],
      },
      didParseCell: (data) => {
        if (data.section === 'body' && headers[data.column.index] === 'Status') {
          const v = String(data.cell.raw || '');
          if (v === 'GOOD') {
            data.cell.styles.textColor = [...C.ok];
            data.cell.styles.fontStyle = 'bold';
          }
          if (v === 'NOT GOOD') {
            data.cell.styles.textColor = [...C.ng];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
      margin: { left: 30, right: 30 },
    });
  }

  // ── Footer di setiap halaman
  const pageCount = (doc as any).getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);

    // Footer separator line
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.5);
    doc.line(30, pageH - 28, pageW - 30, pageH - 28);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.textMuted);
    doc.text(
      'Capstone A3 Kelompok 2 · Filkom Universitas Brawijaya',
      30,
      pageH - 16,
    );
    doc.text(
      `Halaman ${p} dari ${pageCount}`,
      pageW - 30,
      pageH - 16,
      { align: 'right' },
    );
  }

  const arrayBuf = doc.output('arraybuffer');
  return Buffer.from(arrayBuf);
}
