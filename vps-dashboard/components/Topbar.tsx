'use client';

import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import type { SessionUser } from '@/lib/types';

interface TopbarProps {
  user:        SessionUser;
  title?:      string;
  subtitle?:   string;
  /** Klik hamburger di mobile → buka sidebar drawer. */
  onMenuClick?: () => void;
}

/**
 * Topbar dengan title page + live clock. Mirror local web Phase 1.
 */
export function Topbar({ user, title, subtitle, onMenuClick }: TopbarProps) {
  const [time, setTime] = useState('--:--:--');
  const [date, setDate] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      setTime(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
      const days  = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
      const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
      setDate(`${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-bg-topbar border-b border-border px-3 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3 backdrop-blur min-h-[var(--topbar-height)]">
      {/* Hamburger toggle — mobile only */}
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          className="md:hidden p-2 -ml-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-card-hover transition-colors"
          aria-label="Buka sidebar"
        >
          <Menu size={20} />
        </button>
      )}

      <div className="flex-1 min-w-0">
        <h1 className="text-sm sm:text-base lg:text-lg font-bold text-gradient truncate leading-tight">
          {title || 'Capstone Dashboard'}
        </h1>
        {subtitle && (
          <p className="text-[10px] sm:text-[11px] text-text-muted uppercase tracking-wider truncate">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="hidden sm:flex items-center gap-2 bg-bg-card border border-border rounded-full px-3 py-1.5">
          <span
            className="w-2 h-2 rounded-full bg-ok"
            style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
          />
          <span className="font-mono text-xs text-text-primary tracking-wider">{time}</span>
          <span className="text-[10px] text-text-muted">{date}</span>
        </div>
        <div className="text-xs text-text-secondary hidden md:block">
          {user.name}
        </div>
      </div>
    </header>
  );
}
