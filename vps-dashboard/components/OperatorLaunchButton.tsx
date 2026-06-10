'use client';

import { useState } from 'react';
import { Loader2, ExternalLink, Camera, AlertTriangle } from 'lucide-react';

interface Props {
  edgeUrl: string;
}

// Host yang me-resolve ke "komputer ini" — bukan mesin edge kalau diakses remote.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];
const isLocalHostname = (h: string) => LOCAL_HOSTS.includes(h.toLowerCase());

/**
 * Tombol "Buka Dashboard Lokal" untuk operator. Saat klik:
 *   1. POST /api/auth/issue-edge-token → dapat short-lived JWT (15 min)
 *   2. Build URL: {edgeUrl}/?token={JWT}
 *   3. Buka di tab baru
 *
 * Default edgeUrl = http://localhost:3000. Itu hanya valid kalau dashboard
 * diakses DARI mesin edge (mis. localhost dev). Kalau dashboard diakses dari
 * origin lain (mis. Vercel), "localhost" menunjuk ke komputer operator sendiri
 * — bukan mesin edge — sehingga tab cuma loading. Kita deteksi kondisi ini dan
 * peringatkan operator alih-alih membuka tab mati.
 */
export function OperatorLaunchButton({ edgeUrl }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  // Issue token + buka tab edge. Dipanggil langsung saat aman, atau via tombol
  // "Tetap buka" saat operator yakin server.js memang jalan di komputer ini.
  const openEdge = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/issue-edge-token', { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j.success) {
        setError(j.message || 'Gagal issue token');
        setLoading(false);
        return;
      }
      const token = j.data.token as string;
      const url = `${edgeUrl.replace(/\/$/, '')}/?token=${encodeURIComponent(token)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      setError(e?.message || 'Network error');
    }
    setLoading(false);
  };

  const launch = () => {
    setError(null);
    setWarn(null);

    // Deteksi mismatch: origin non-lokal (mis. Vercel) tapi edge masih localhost.
    let edgeHost = '';
    try { edgeHost = new URL(edgeUrl).hostname; } catch { /* URL invalid → biarkan openEdge yang gagal */ }
    const pageIsLocal = isLocalHostname(window.location.hostname);
    const edgeIsLocal = isLocalHostname(edgeHost);

    if (!pageIsLocal && edgeIsLocal) {
      setWarn(
        `Dashboard diakses dari "${window.location.host}", tapi Edge URL masih "${edgeUrl}" — ` +
        `alamat itu menunjuk ke komputer Anda sendiri, bukan mesin edge, jadi tab hanya akan loading. ` +
        `Solusi: jalankan server.js di komputer ini, atau minta manager meng-update Edge URL ke ` +
        `alamat mesin edge (IP LAN mis. http://192.168.x.x:3000, atau URL tunnel publik).`,
      );
      return;
    }
    openEdge();
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

      {warn && (
        <div className="flex flex-col items-start gap-2 bg-ng/10 border border-ng/40 rounded-md px-3 py-2 text-xs text-ng max-w-md">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{warn}</span>
          </div>
          <button
            type="button"
            onClick={openEdge}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded border border-ng/60 px-2.5 py-1 font-semibold hover:bg-ng/20 disabled:opacity-50 transition-colors"
          >
            {loading
              ? <Loader2 size={12} className="animate-spin" />
              : <ExternalLink size={12} />
            }
            Tetap buka (server.js jalan di komputer ini)
          </button>
        </div>
      )}

      {error && (
        <div className="text-xs text-ng">{error}</div>
      )}
      <p className="text-xs text-text-muted font-mono">
        Target: {edgeUrl}
      </p>
    </div>
  );
}
