import type { Config } from 'tailwindcss';

/**
 * Tailwind config — design tokens dari shared CAPSTONE/theme.css.
 * Setiap value disini me-reference CSS variable di theme.css supaya
 * VPS dashboard visually identik dengan local web (Phase 1).
 *
 * Edit warna? → ubah di CAPSTONE/theme.css, kedua sisi otomatis sync.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Background layers
        'bg-primary':   'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-card':      'var(--bg-card)',
        'bg-card-hover':'var(--bg-card-hover)',
        'bg-sidebar':   'var(--bg-sidebar)',
        'bg-topbar':    'var(--bg-topbar)',

        // Borders
        'border':       'var(--border)',
        'border-light': 'var(--border-light)',

        // Accents
        'accent-blue':  'var(--accent-blue)',
        'accent-cyan':  'var(--accent-cyan)',

        // Status
        'ok':           'var(--ok-primary)',
        'ng':           'var(--ng-primary)',

        // Role accents
        'role-operator':   'var(--role-operator)',
        'role-supervisor': 'var(--role-supervisor)',
        'role-manager':    'var(--role-manager)',

        // Text
        'text-primary':   'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted':     'var(--text-muted)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
    },
  },
  plugins: [],
};

export default config;
