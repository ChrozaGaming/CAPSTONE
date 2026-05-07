import type { Role } from '@/lib/types';

interface RoleBadgeProps {
  role: Role;
  size?: 'sm' | 'md';
}

const ROLE_LABEL: Record<Role, string> = {
  operator:   'Operator',
  supervisor: 'Supervisor',
  manager:    'Manager',
};

/**
 * Colored badge sesuai role. Pakai CSS variables `--role-*` dari theme.css
 * untuk warna konsisten dengan local web.
 */
export function RoleBadge({ role, size = 'md' }: RoleBadgeProps) {
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span
      className={`${sizeClass} rounded-md font-bold uppercase tracking-wider inline-block`}
      style={{
        color:  `var(--role-${role})`,
        border: `1px solid var(--role-${role})`,
        backgroundColor: `var(--role-${role})10`,
      }}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}
