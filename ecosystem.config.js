/**
 * PM2 ecosystem config — Capstone A3 Kelompok 2 (Filkom UB)
 *
 * Untuk deploy di VPS Ubuntu Server:
 *   sudo apt install nodejs python3 python3-pip
 *   pip install -r requirements.txt --break-system-packages   (atau via venv)
 *   npm install
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup           # auto-start on boot
 *
 * Localhost dev tetap pakai cara biasa (node server.js & python edge_camera.py).
 */
/**
 * PM2 ecosystem config — Capstone A3 Kelompok 2 (Filkom UB)
 *
 * 3 services yang dijalankan PM2:
 *   1. capstone-server   — Express + WebSocket (LAN-only) di port 3000
 *      Operator dashboard, live camera stream proxy, REST API.
 *   2. capstone-edge     — Python edge_camera.py
 *      Pipeline kalibrasi/measurement + WS publisher (port 8765/8766).
 *   3. capstone-vps      — Next.js dashboard di port 3001
 *      Supervisor + manager web (login + role-based pages).
 *
 * Production VPS deploy:
 *   sudo apt install nodejs python3 python3-pip nginx
 *   pip install -r requirements.txt
 *   npm install
 *   cd vps-dashboard && npm install && npx prisma generate && npx prisma db push && npm run prisma:seed && npm run build
 *   cd ..
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup
 *
 * Note: kalau cuma deploy VPS dashboard saja (Pi/edge-camera tidak di VPS),
 * jalankan: `pm2 start ecosystem.config.js --only capstone-vps`
 */
module.exports = {
  apps: [
    {
      name: 'capstone-server',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file:  './logs/server.err.log',
      out_file:    './logs/server.out.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'capstone-edge',
      script: 'edge_camera.py',
      interpreter: 'python3',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 5,
      min_uptime: '30s',
      max_memory_restart: '1G',
      env: {
        // Stream module config — semua optional (default sudah sensible)
        STREAM_PORT: 8765,
        CONTROL_PORT: 8766,
        STREAM_BIND: '0.0.0.0',
        STREAM_MAX_WIDTH: 1920,    // 1080p pass-through; turunkan ke 1280 kalau bandwidth VPS sempit
        STREAM_QUALITY: 80,        // JPEG quality 1-100
        STREAM_FPS_TARGET: 30,
        // Future: ganti ke 'webrtc' kalau migrasi ke aiortc
        STREAM_BACKEND: 'ws',
      },
      error_file:  './logs/edge.err.log',
      out_file:    './logs/edge.out.log',
      merge_logs: true,
      time: true,
    },
    {
      // VPS Next.js dashboard — supervisor + manager (Phase 3+).
      // Standalone build di .next/standalone/server.js yang dihasilkan
      // oleh `next build` dengan `output: 'standalone'`.
      name: 'capstone-vps',
      script: './vps-dashboard/.next/standalone/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOSTNAME: '0.0.0.0',
        // Variabel di bawah dibaca oleh app — pastikan sama dengan
        // vps-dashboard/.env saat dev. Production: set lewat shell ENV.
        // DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, LOCAL_EDGE_URL
      },
      error_file:  './logs/vps.err.log',
      out_file:    './logs/vps.out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
