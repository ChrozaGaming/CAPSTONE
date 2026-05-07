'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { LayoutDashboard, Users, Camera, LogOut, History, X } from 'lucide-react';
import type { SessionUser } from '@/lib/types';
import { RoleBadge } from './RoleBadge';

interface SidebarProps {
  user:    SessionUser;
  /** Sidebar visible state untuk mobile drawer. Desktop ignore prop ini. */
  open?:   boolean;
  /** Callback saat drawer ditutup (klik X / backdrop / Esc). */
  onClose?: () => void;
}

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}

function NavItem({ href, icon, label, active }: NavItemProps) {
  return (
    <Link
      href={href}
      className={`
        flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors relative
        ${active
          ? 'bg-accent-blue/15 text-accent-cyan font-semibold'
          : 'text-text-secondary hover:bg-bg-card-hover hover:text-text-primary'}
      `}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-accent-cyan rounded-r-md" />}
      <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function Sidebar({ user, open = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  // Nav items per role
  const navItems = [
    {
      href:  '/dashboard',
      icon:  <LayoutDashboard size={18} />,
      label: 'Dashboard',
      visible: true,
    },
    {
      href:  '/operator',
      icon:  <Camera size={18} />,
      label: 'Live Camera',
      visible: user.role === 'operator',
    },
    {
      href:  '/admin',
      icon:  <Users size={18} />,
      label: 'Manage Users',
      visible: user.role === 'manager',
    },
    {
      href:  '/admin/audit',
      icon:  <History size={18} />,
      label: 'Audit Log',
      visible: user.role === 'manager',
    },
  ].filter(it => it.visible);

  return (
    <aside
      className={`
        bg-bg-sidebar border-r border-border flex flex-col w-[var(--sidebar-width)]
        fixed md:sticky top-0 left-0 h-screen z-50
        transition-transform duration-200 ease-out
        ${open ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'}
        md:shadow-none
      `}
      aria-label="Sidebar navigation"
    >
      {/* Brand */}
      <div className="px-4 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-md bg-gradient-to-br from-accent-blue to-accent-cyan flex items-center justify-center text-lg shadow-md flex-shrink-0">
          🔬
        </div>
        <div className="flex flex-col leading-tight overflow-hidden flex-1 min-w-0">
          <span className="font-bold text-sm text-text-primary tracking-tight">Capstone A3</span>
          <span className="text-[10px] text-text-muted uppercase tracking-wider">Inspection Dashboard</span>
        </div>
        {/* Close button — visible only di mobile saat drawer open */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="md:hidden p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-card-hover transition-colors"
            aria-label="Tutup sidebar"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 p-2 flex-1">
        {navItems.map(it => (
          <NavItem
            key={it.href}
            href={it.href}
            icon={it.icon}
            label={it.label}
            active={pathname === it.href || pathname.startsWith(it.href + '/')}
          />
        ))}
      </nav>

      {/* User card + logout */}
      <div className="border-t border-border p-3 flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5 p-2 rounded-md bg-bg-card">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
            style={{
              background: `linear-gradient(135deg, var(--role-${user.role}), var(--accent-blue))`,
            }}
          >
            {(user.name || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col leading-tight overflow-hidden flex-1 min-w-0">
            <span className="font-semibold text-xs text-text-primary truncate">{user.name}</span>
            <RoleBadge role={user.role} size="sm" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-2 justify-center px-3 py-2 rounded-md border border-border text-text-secondary text-xs font-semibold uppercase tracking-wider hover:border-ng hover:text-ng hover:bg-ng/10 transition-colors"
        >
          <LogOut size={14} />
          Logout
        </button>
      </div>
    </aside>
  );
}
