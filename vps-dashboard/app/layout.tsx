import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Capstone Dashboard — Supervisor & Manager',
  description: 'Automated Dimensional Inspection — VPS Dashboard untuk supervisor & manager. Capstone A3 Kelompok 2 · Filkom Universitas Brawijaya.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
