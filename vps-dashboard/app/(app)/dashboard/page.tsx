import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import { StatsGrid } from '@/components/StatsGrid';
import { DistributionChart } from '@/components/Chart';
import { InspectionTable } from '@/components/InspectionTable';
import { GroupedClassificationTable } from '@/components/GroupedClassificationTable';
import { ExportMenu } from '@/components/ExportMenu';
import type { InspectionRow, InspectionStats } from '@/lib/types';

/**
 * Dashboard utama (full Phase 4).
 * - StatsGrid: 5 cards summary
 * - Chart: bar chart distribusi GOOD vs NOT GOOD
 * - InspectionTable: paginated, sortable, filterable
 *
 * Dipakai oleh role: supervisor, manager, dan operator.
 * Operator akan lihat tambahan card "Buka Live Camera Lokal" via link
 * sidebar (Live Camera) atau /operator page.
 */
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as any).role as string;

  // Query data dari local PG (Phase 6 nanti pakai sync ke VPS PG)
  let rows: InspectionRow[] = [];
  let dbError: string | null = null;
  try {
    const data = await prisma.inspection.findMany({
      orderBy: { timestamp: 'desc' },
      take: 500, // safety limit
    });
    rows = data.map(r => ({
      id:           r.id,
      object_name:  r.object_name,
      dimension_mm: r.dimension_mm,
      width_mm:     r.width_mm,
      confidence:   r.confidence,
      status:       r.status as 'GOOD' | 'NOT GOOD',
      timestamp:    r.timestamp.toISOString(),
    }));
  } catch (e: any) {
    dbError = e.message || 'Unknown DB error';
  }

  // Compute stats
  const total = rows.length;
  const good = rows.filter(r => r.status === 'GOOD').length;
  const notGood = rows.filter(r => r.status === 'NOT GOOD').length;
  const stats: InspectionStats = {
    total,
    good,
    notGood,
    goodPct: total > 0 ? (good / total) * 100 : 0,
    ngPct:   total > 0 ? (notGood / total) * 100 : 0,
  };

  // Export hanya untuk supervisor + manager (operator focus on live camera)
  const canExport = role === 'supervisor' || role === 'manager';

  return (
    <div className="space-y-1">
      {/* Welcome header + Export button (kanan untuk supervisor/manager) */}
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold mb-1 text-text-primary">
            Selamat datang, {session.user.name?.split(' ')[0] || 'User'}
          </h2>
          <p className="text-sm text-text-secondary">
            {role === 'operator'   && '🎥 Sebagai operator, Anda bisa membuka Live Camera dari sidebar untuk monitoring real-time.'}
            {role === 'supervisor' && '📊 Sebagai supervisor, pantau distribusi inspeksi dan riwayat dari sini.'}
            {role === 'manager'    && '👥 Sebagai manager, Anda dapat mengelola users di Manage Users dari sidebar.'}
          </p>
        </div>
        {canExport && rows.length > 0 && (
          <ExportMenu rows={rows} />
        )}
      </div>

      {dbError && (
        <div className="bg-ng/10 border border-ng/40 rounded-md p-3 mb-5 text-sm text-ng">
          ❌ Database error: {dbError}
        </div>
      )}

      <StatsGrid stats={stats} />

      <DistributionChart good={stats.good} notGood={stats.notGood} />

      <GroupedClassificationTable rows={rows} />

      <InspectionTable rows={rows} />
    </div>
  );
}
