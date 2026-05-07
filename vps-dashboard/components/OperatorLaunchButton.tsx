'use client';

import { useState } from 'react';
import { Loader2, ExternalLink, Camera } from 'lucide-react';

interface Props {
  edgeUrl: string;
}

/**
 * Tombol "Buka Dashboard Lokal" untuk operator. Saat klik:
 *   1. POST /api/auth/issue-edge-token → dapat short-lived JWT (15 min)
 *   2. Build URL: {edgeUrl}/?token={JWT}
 *   3. Buka di tab baru
 *
 * Local server.js (Phase 2) akan validate token via /api/auth/verify,
 * lalu local script.js (Phase 2) gates UI ke role operator.
 */
export function OperatorLaunchButton({ edgeUrl }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = async () => {
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
      {error && (
        <div className="text-xs text-ng">{error}</div>
      )}
      <p className="text-xs text-text-muted font-mono">
        Target: {edgeUrl}
      </p>
    </div>
  );
}
