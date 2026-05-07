import type { InspectionStats } from '@/lib/types';

interface StatsGridProps {
  stats: InspectionStats;
}

interface StatCardProps {
  icon: string;
  label: string;
  value: string | number;
  accent: 'blue' | 'ok' | 'ng' | 'cyan';
}

function StatCard({ icon, label, value, accent }: StatCardProps) {
  const colorMap = {
    blue: 'var(--accent-blue)',
    ok:   'var(--ok-primary)',
    ng:   'var(--ng-primary)',
    cyan: 'var(--accent-cyan)',
  };
  const accentColor = colorMap[accent];
  return (
    <div className="bg-bg-card border border-border rounded-lg p-4 text-center relative overflow-hidden hover:bg-bg-card-hover transition-colors">
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px]"
        style={{ background: accentColor }}
      />
      <span className="text-2xl block mb-1.5">{icon}</span>
      <span
        className="font-mono font-bold text-2xl block leading-none mb-1"
        style={{ color: accentColor }}
      >
        {value}
      </span>
      <span className="text-[11px] text-text-muted uppercase tracking-wider font-medium">
        {label}
      </span>
    </div>
  );
}

/**
 * 5-card grid mirroring local web Phase 1 (Total, GOOD, NOT GOOD, %GOOD, %NOT GOOD).
 */
export function StatsGrid({ stats }: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
      <StatCard icon="📊" label="Total Inspeksi"            value={stats.total}                    accent="blue" />
      <StatCard icon="✅" label="Total GOOD"                 value={stats.good}                     accent="ok"   />
      <StatCard icon="❌" label="Total NOT GOOD"             value={stats.notGood}                  accent="ng"   />
      <StatCard icon="📈" label="Persentase GOOD (Total)"    value={stats.goodPct.toFixed(1) + '%'} accent="cyan" />
      <StatCard icon="📉" label="Persentase NOT GOOD (Total)" value={stats.ngPct.toFixed(1) + '%'}  accent="ng"   />
    </div>
  );
}
