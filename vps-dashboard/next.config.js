/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── Production deploy mode ────────────────────────────────────────
  // 'standalone' menghasilkan .next/standalone/server.js yang siap
  // dijalankan PM2 di VPS Ubuntu tanpa node_modules besar di server.
  // Build artifact: .next/standalone/ + .next/static/ + public/
  output: 'standalone',

  reactStrictMode: true,

  // ── Trusted hosts — frontend bisa fetch ke local Express (port 3000)
  // saat operator klik "Buka Dashboard Lokal". Whitelist juga origin
  // local + VPS production saat nanti deploy.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options',  value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
