import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { OperatorLaunchButton } from '@/components/OperatorLaunchButton';

/**
 * /operator — Operator-only page.
 * Tombol launch ke local edge dashboard dengan JWT token.
 */
export default async function OperatorPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as any).role as string;
  if (role !== 'operator') redirect('/dashboard');

  const userId = (session.user as any).id as string;
  const user = await prisma.user.findUnique({ where: { id: userId } });

  // Edge URL: dari profil user → fallback ke env LOCAL_EDGE_URL → fallback localhost:3000
  const edgeUrl =
    user?.edge_url ||
    process.env.LOCAL_EDGE_URL ||
    'http://localhost:3000';

  return (
    <div className="space-y-1">
      <div className="mb-5">
        <h2 className="text-xl sm:text-2xl font-bold mb-1 text-text-primary flex items-center gap-2">
          🎥 Live Camera Tracking
        </h2>
        <p className="text-sm text-text-secondary">
          Buka dashboard lokal yang terhubung dengan{' '}
          <code className="font-mono text-accent-cyan">edge_camera.py</code>{' '}
          untuk melihat live camera tracking dan mengirim keybind kontrol.
        </p>
      </div>

      <div className="bg-bg-card border-2 border-role-operator/40 rounded-lg p-6">
        <h3 className="text-sm uppercase tracking-wider text-role-operator mb-2 font-semibold">
          Akses Live Camera
        </h3>
        <p className="text-text-secondary mb-4">
          Tombol di bawah akan membuka dashboard lokal di tab baru dengan
          token JWT short-lived (15 menit). Token akan otomatis di-validate
          oleh local server.js untuk grant akses operator.
        </p>

        <OperatorLaunchButton edgeUrl={edgeUrl} />
      </div>

      <div className="mt-5 bg-bg-card border border-border rounded-lg p-5">
        <h3 className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-2">
          Cara Kerja
        </h3>
        <ol className="text-sm text-text-secondary space-y-2 list-decimal list-inside">
          <li>Klik <strong className="text-role-operator">Buka Dashboard Lokal</strong> di atas</li>
          <li>VPS Next.js issue JWT token (sign dengan secret bersama)</li>
          <li>
            Browser buka <code className="font-mono text-accent-cyan text-xs">{edgeUrl}/?token=…</code> di tab baru
          </li>
          <li>Local server.js validate token via <code className="font-mono">/api/auth/verify</code></li>
          <li>Local web grant akses operator UI: live camera + keybind</li>
        </ol>

        <p className="text-xs text-text-muted mt-3">
          💡 Untuk update edge URL (mis. ganti dari laptop ke Pi nanti),
          hubungi manager untuk update profil Anda.
        </p>
      </div>
    </div>
  );
}
