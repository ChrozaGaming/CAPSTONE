'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Footer } from './Footer';
import type { SessionUser } from '@/lib/types';

interface AppShellProps {
  user:     SessionUser;
  children: React.ReactNode;
}

/**
 * Authenticated shell — manage sidebar drawer state untuk mobile.
 *
 * Layout:
 *   - Desktop (md+): sidebar sticky kiri, main + footer di kanan
 *   - Mobile (<md):  sidebar off-canvas drawer, dibuka via hamburger di topbar
 *
 * State:
 *   - sidebarOpen: visibility drawer di mobile
 *   - Auto-close on route change (pathname useEffect)
 *   - Auto-close on Esc
 *   - Backdrop click → close
 */
export function AppShell({ user, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close drawer saat user navigasi ke route lain
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Esc to close
  useEffect(() => {
    if (!sidebarOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sidebarOpen]);

  // Lock body scroll saat drawer open di mobile
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex flex-1 min-h-screen">
        {/* Sidebar — drawer di mobile, sticky di desktop */}
        <Sidebar user={user} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Backdrop mobile only */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Main column */}
        <div className="flex flex-col flex-1 min-w-0">
          <Topbar
            user={user}
            title="Capstone Dashboard"
            subtitle="Monitoring Inspeksi Dimensi"
            onMenuClick={() => setSidebarOpen(true)}
          />
          <main className="flex-1 p-3 sm:p-4 md:p-6 max-w-7xl mx-auto w-full">
            {children}
          </main>
          <Footer />
        </div>
      </div>
    </div>
  );
}
