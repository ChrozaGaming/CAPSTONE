/**
 * Footer — Capstone credit + tahun + commit info (kalau ada).
 * Muncul di bawah semua content, di luar main scrollable area.
 */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-bg-topbar/50 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] sm:text-xs text-text-muted">
        <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
          <span className="font-mono font-semibold text-text-secondary">Capstone A3</span>
          <span className="opacity-50">·</span>
          <span>Kelompok 2 · Filkom Universitas Brawijaya</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
          <span>Automated Dimensional Inspection</span>
          <span className="opacity-50">·</span>
          <span>© {year}</span>
        </div>
      </div>
    </footer>
  );
}
