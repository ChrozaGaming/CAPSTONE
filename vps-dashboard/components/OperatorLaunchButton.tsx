'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Camera } from 'lucide-react';

interface Props {
  edgeUrl: string;
}

// Timeout fetch token — route serverless bisa lambat/hang di Vercel cold start.
const TOKEN_TIMEOUT_MS = 6000;

/**
 * Tombol "Buka Dashboard Lokal" untuk operator.
 *
 * Penting (alasan revisi):
 *  - TIDAK pakai window.open. Chrome memblokir window.open sebagai popup meski
 *    dipanggil sinkron & izin sudah diberikan (Safari lebih longgar). Solusi
 *    lintas-browser: pakai elemen <a target="_blank"> asli — klik user pada
 *    anchor adalah navigasi biasa, BUKAN popup, jadi tidak pernah diblokir.
 *  - Token (auth operator di local server.js) di-PRA-AMBIL saat halaman dibuka
 *    dan di-refresh saat tab kembali fokus (token short-lived 15 mnt), supaya
 *    href anchor sudah berisi token saat diklik. Kalau route token lambat/hang,
 *    href fallback ke edge tanpa token — server.js lokal handle auth sendiri.
 *
 * Default edgeUrl = http://localhost:3000 (resolve ke komputer operator; jalankan
 * server.js di mesin yang sama saat klik).
 */
export function OperatorLaunchButton({ edgeUrl }: Props) {
  const base = edgeUrl.replace(/\/$/, '');
  const [token, setToken] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);

  const fetchToken = useCallback(async () => {
    setFetching(true);
    try {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), TOKEN_TIMEOUT_MS);
      const r = await fetch('/api/auth/issue-edge-token', { method: 'POST', signal: ctrl.signal });
      clearTimeout(tm);
      if (r.ok) {
        const j = await r.json();
        if (j?.success) setToken(j.data.token as string);
      }
    } catch {
      /* timeout / hang / network error → token tetap null, link buka tanpa token */
    }
    setFetching(false);
  }, []);

  useEffect(() => {
    fetchToken();
    // Refresh token tiap tab kembali fokus (token cuma valid 15 mnt).
    const onFocus = () => { fetchToken(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchToken]);

  const href = token ? `${base}/?token=${encodeURIComponent(token)}` : base;

  let tokenStatus = ' · tanpa token (server.js handle auth)';
  if (fetching) tokenStatus = ' · menyiapkan token…';
  else if (token) tokenStatus = ' · token siap';

  return (
    <div className="flex flex-col items-start gap-2">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 bg-role-operator hover:opacity-90 text-bg-primary font-bold px-5 py-2.5 rounded-md transition-opacity"
      >
        <Camera size={16} />
        Buka Dashboard Lokal
        <ExternalLink size={14} />
      </a>

      <p className="text-xs text-text-muted font-mono">
        Target: {edgeUrl} · jalankan <span className="font-semibold">server.js</span> di komputer ini
        {tokenStatus}
      </p>
    </div>
  );
}
