'use client';

import { useState } from 'react';
import { Loader2, ExternalLink, Camera } from 'lucide-react';

interface Props {
  edgeUrl: string;
}

// Batas tunggu token sebelum tab tetap dibuka tanpa token. Cukup untuk cold
// start serverless Vercel, tapi tidak bikin tombol "muter" selamanya kalau
// route /api/auth/issue-edge-token menggantung.
const TOKEN_TIMEOUT_MS = 6000;

/**
 * Tombol "Buka Dashboard Lokal" untuk operator.
 *
 * Penting (alasan revisi):
 *  - Tab dibuka SINKRON saat klik (sebelum await). window.open setelah await
 *    kehilangan user-activation → diblokir popup-blocker, terutama di Vercel
 *    di mana fetch token lebih lambat. Itu yang bikin "tombol muter terus /
 *    tidak ke localhost:3000".
 *  - Token (untuk auth operator di local server.js) diambil best-effort DENGAN
 *    timeout. Kalau lambat/gagal/hang, tab tetap dibuka ke edge tanpa token —
 *    server.js lokal menangani auth sendiri (login redirect / dev-token).
 *
 * Default edgeUrl = http://localhost:3000 (resolve ke komputer operator; jalankan
 * server.js di mesin yang sama saat klik).
 */
export function OperatorLaunchButton({ edgeUrl }: Props) {
  const [loading, setLoading] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  const launch = async () => {
    setManualUrl(null);
    setLoading(true);

    const base = edgeUrl.replace(/\/$/, '');

    // 1. Buka localhost:3000 LANGSUNG & SINKRON (sebelum await) → tab terbuka
    //    instan dan tidak kena popup-block. Operator langsung lihat dashboard
    //    lokal walau token belum/ tidak didapat.
    const win = window.open(base, '_blank');
    if (!win) {
      // Popup diblokir total (rare untuk window.open sinkron) → kasih link manual.
      setManualUrl(base);
      setLoading(false);
      return;
    }

    // 2. Ambil token (best-effort + timeout) untuk auth operator di server.js.
    //    Tidak boleh nge-block selamanya — kalau route hang/lambat, tab sudah
    //    terbuka di localhost:3000 tanpa token (server.js handle auth sendiri).
    let token: string | null = null;
    try {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), TOKEN_TIMEOUT_MS);
      const r = await fetch('/api/auth/issue-edge-token', { method: 'POST', signal: ctrl.signal });
      clearTimeout(tm);
      if (r.ok) {
        const j = await r.json();
        if (j?.success) token = j.data.token as string;
      }
    } catch {
      /* timeout / hang / network error → biarkan tab tetap di localhost:3000 */
    }

    // 3. Upgrade tab ke URL ber-token HANYA kalau token didapat (hindari reload
    //    tak perlu kalau token null).
    if (token && !win.closed) {
      try { win.location.href = `${base}/?token=${encodeURIComponent(token)}`; }
      catch { /* tab sudah cross-origin di localhost — biarkan apa adanya */ }
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={launch}
        disabled={loading}
        className="inline-flex items-center gap-2 bg-role-operator hover:opacity-90 disabled:opacity-50 text-bg-primary font-bold px-5 py-2.5 rounded-md transition-opacity"
      >
        {loading
          ? <Loader2 size={16} className="animate-spin" />
          : <Camera size={16} />
        }
        Buka Dashboard Lokal
        <ExternalLink size={14} />
      </button>

      {manualUrl && (
        <div className="bg-ng/10 border border-ng/40 rounded-md px-3 py-2 text-xs text-ng max-w-md">
          Popup diblokir browser. Buka manual:{' '}
          <a href={manualUrl} target="_blank" rel="noopener noreferrer" className="underline font-semibold break-all">
            {manualUrl}
          </a>
        </div>
      )}

      <p className="text-xs text-text-muted font-mono">
        Target: {edgeUrl} · jalankan <span className="font-semibold">server.js</span> di komputer ini
      </p>
    </div>
  );
}
