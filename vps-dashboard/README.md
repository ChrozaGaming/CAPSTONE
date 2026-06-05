# Capstone VPS Dashboard

Next.js 14 + NextAuth.js v5 + Prisma — dashboard untuk **supervisor** dan **manager** mengakses data inspeksi dari mana saja. **Tidak include live camera** (camera tetap LAN-only di local web `index.html`).

> Capstone A3 Kelompok 2 · Filkom Universitas Brawijaya

---

## Stack

| Layer | Tech |
| --- | --- |
| Framework | Next.js 14 App Router (TypeScript) |
| Auth | NextAuth.js v5 + Credentials provider + Prisma Adapter |
| ORM | Prisma 5 + PostgreSQL |
| Styling | Tailwind CSS + design tokens dari `../theme.css` |
| Build | `output: 'standalone'` (siap PM2 + Nginx) |

---

## Roles

| Role | Akses |
| --- | --- |
| `operator` | Login VPS → tombol "Buka Dashboard Lokal" → redirect ke local web (live camera + keybind) |
| `supervisor` | Tabel inspeksi + chart distribusi GOOD/NOT GOOD + filter |
| `manager` | Sama seperti supervisor + Admin page (CRUD user) |

---

## Local Development

### 1. Setup PostgreSQL

VPS dashboard pakai **PG yang sama** dengan local server.js (capstone DB). Schema NextAuth (User, Account, Session, VerificationToken) ditambahkan di samping `inspections` table existing.

```bash
# Pastikan PG jalan dan database `capstone` ada
psql -U postgres -d capstone -c "SELECT 1"
```

### 2. Install dependencies

```bash
cd vps-dashboard
npm install
```

### 3. Setup `.env`

```bash
cp .env.example .env
# Edit DATABASE_URL kalau password PG berbeda
# NEXTAUTH_SECRET HARUS sama dengan JWT_SECRET di ../[.env](../.env)
```

### 4. Push Prisma schema + seed users

```bash
npx prisma db push       # buat tabel User/Account/Session
npm run prisma:seed      # 3 demo users
```

Demo credentials:
- **operator** — `operator@capstone.dev` / `operator123`
- **supervisor** — `supervisor@capstone.dev` / `supervisor123`
- **manager** — `manager@capstone.dev` / `manager123`

### 5. Run dev server

```bash
npm run dev   # http://localhost:3001
```

Buka browser → login dengan salah satu credentials di atas.

---

## Production Build

```bash
npm run build         # output ke .next/standalone/server.js
node .next/standalone/server.js   # test prod build local
```

---

## Deploy ke VPS Ubuntu Server (Nginx + PM2 + Let's Encrypt)

### Prereq di VPS

```bash
sudo apt update && sudo apt install -y nodejs npm postgresql nginx certbot python3-certbot-nginx
sudo npm install -g pm2
```

### Clone + setup

```bash
git clone https://github.com/ChrozaGaming/CAPSTONE.git /opt/capstone
cd /opt/capstone

# Local server.js deps
npm install

# VPS dashboard deps + build
cd vps-dashboard
npm install
cp .env.example .env
# Edit .env dengan production values:
#   DATABASE_URL    → PG production
#   NEXTAUTH_SECRET → openssl rand -base64 48 (HARUS sama dengan ../[.env JWT_SECRET])
#   NEXTAUTH_URL    → https://your-vps.example.com
#   LOCAL_EDGE_URL  → http://pi.local:3000 (atau IP statis Pi)

npx prisma db push
npm run prisma:seed   # OPSIONAL — biasanya manager tambah user manual via Admin page
npm run build

cd ..
mkdir -p logs
```

### Nginx reverse proxy

`/etc/nginx/sites-available/capstone`:

```nginx
server {
  listen 80;
  server_name your-vps.example.com;

  location / {
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_cache_bypass $http_upgrade;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/capstone /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Let's Encrypt SSL

```bash
sudo certbot --nginx -d your-vps.example.com
# Otomatis update Nginx config jadi listen 443 + auto-renew
```

### PM2 start

Dari root `/opt/capstone`:

```bash
pm2 start ecosystem.config.js --only capstone-vps
pm2 save
pm2 startup    # ikuti instruksi yang muncul (paste command sudo)
```

Cek status:

```bash
pm2 list
pm2 logs capstone-vps
pm2 monit
```

### Update flow

```bash
cd /opt/capstone
git pull
cd vps-dashboard
npm install
npx prisma db push
npm run build
pm2 reload capstone-vps   # zero-downtime restart
```

---

## File Structure

```
vps-dashboard/
├── app/
│   ├── (auth)/login/page.tsx       Login form (Phase 4 full implementation)
│   ├── (app)/
│   │   ├── layout.tsx              Sidebar + topbar (Phase 4)
│   │   └── dashboard/page.tsx      Main dashboard (Phase 4 full)
│   ├── api/auth/[...nextauth]/     NextAuth catch-all
│   ├── globals.css                 Tailwind + theme tokens
│   ├── layout.tsx                  Root layout
│   └── page.tsx                    Redirect / → /login or /dashboard
├── lib/
│   ├── auth.ts                     NextAuth config
│   ├── db.ts                       Prisma singleton
│   └── jwt.ts                      JWT helpers (mirror ../server.js)
├── prisma/
│   ├── schema.prisma               User + Account + Session + Inspection
│   └── seed.ts                     3 demo users
├── .env.example                    Template environment
├── next.config.js                  output: standalone
├── package.json
├── tailwind.config.ts              Theme tokens dari shared theme.css
└── tsconfig.json
```

---

## Architecture (recap)

```
LAN PABRIK / LAB                       INTERNET / VPS
┌────────────────────────┐             ┌─────────────────────────┐
│ Pi/laptop edge         │             │ VPS Ubuntu (this app)   │
│ - edge_camera.py       │ ──POST──→   │ - Next.js port 3001     │
│ - server.js port 3000  │  inspeksi   │ - PostgreSQL            │
│ - LIVE CAM (LAN-only)  │             │ - dashboard data only   │
│                        │             │ - login + role-based    │
│ Operator akses:        │             │ Supervisor + manager:   │
│ http://localhost:3000  │             │ https://vps.example.com │
└────────────────────────┘             └─────────────────────────┘
```

**Penting**: video kamera **TIDAK** lewat VPS (TOS rumahweb tidak izinkan video relay). Cuma **data hasil inspeksi** (~1 KB per row) yang sync ke VPS.

---

## Troubleshooting

| Masalah | Solusi |
| --- | --- |
| `Error: Can't reach database server` | Cek `DATABASE_URL`, pastikan PG running, password benar |
| Login form gagal | Cek `NEXTAUTH_SECRET` ≥32 char, `NEXTAUTH_URL` match domain |
| `Invalid token` saat login | Re-seed: `npm run prisma:seed`. bcrypt hash mungkin out of sync |
| Build error: `Module not found '@/lib/auth'` | Cek `tsconfig.json` paths, jalankan `npx prisma generate` lagi |
| PM2 process restart loop | Cek `pm2 logs capstone-vps` — biasanya .env hilang/salah |

---

## Phase Roadmap

- ✅ **Phase 3**: Scaffold + auth + login flow + role-based gating
- 🚧 **Phase 4**: Sidebar + topbar + StatsGrid + DashboardTable + Chart components
- 🚧 **Phase 5**: VPS API routes (sync sink + verify untuk local server.js)
- 🚧 **Phase 6**: Local server.js sync background job
- 🚧 **Phase 7**: Visual QA — design tokens consistency dengan local web
- 🚧 **Phase 8**: Production deploy ke rumahweb VPS
