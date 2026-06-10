# Changelog

Semua perubahan penting pada project ini didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
dan project ini mengikuti [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.6.1] — 2026-06-10

### 🔒 Fixed — Operator "Buka Dashboard Lokal" di Vercel

- Tombol tidak lagi **"muter selamanya"** saat dashboard di-deploy di Vercel.
  Penyebab: `window.open` dipanggil **setelah** `await fetch(token)` sehingga
  kehilangan *user-activation* → popup diblokir browser; plus fetch token tanpa
  timeout (route serverless lambat/menggantung di cold start).
- **Fix** (`vps-dashboard/components/OperatorLaunchButton.tsx`): buka tab
  `localhost:3000` secara **sinkron saat klik** (anti popup-block, tab langsung
  terbuka), ambil token *best-effort* dengan **timeout 6 dtk**, lalu upgrade tab
  ke URL ber-token kalau token didapat. Kalau token lambat/hang, tab tetap
  terbuka di `localhost:3000` tanpa token (server.js lokal menangani auth
  sendiri). Default Edge URL tetap `http://localhost:3000`.

---

## [2.6.0] — 2026-06-10

### 🎯 Tema rilis: Runtime DB Source Switch — Local PostgreSQL ⇄ Cloud (Supabase) + Operator Edge UX

Versi ini menambahkan **toggle sumber database saat runtime** di dashboard
operator: pindah antara PostgreSQL lokal dan Supabase (cloud) **tanpa restart**,
lengkap dengan persistensi pilihan, rollback otomatis, dan self-healing reconnect.
Ditambah perbaikan UX tombol *"Buka Dashboard Lokal"* di `vps-dashboard` supaya
tidak membuka tab mati saat diakses dari origin remote (Vercel).

**Backwards-compatible** dengan v2.5.0: default `DB_MODE=local`; `edge_camera.py`,
pipeline kalibrasi, dan skema storage tidak disentuh.

### ✨ Added — DB Source Switch (local ⇄ cloud)

- **Toggle Local/Cloud** di connection-bar dashboard (`index.html`, `script.js`,
  `style.css`) — klik untuk pindah sumber DB; broadcast `db.mode_changed` via
  WebSocket ke semua dashboard yang terhubung.
- **`switchDatabase()`** di `server.js`: tear-down pool + LISTEN client lama →
  rebuild ke target baru. Pilihan dipersist ke `data/db_mode.json` (diingat saat
  restart). **Rollback otomatis** ke mode sebelumnya kalau target baru gagal
  konek. **Self-heal** reconnect kalau pool & rollback dua-duanya gagal.
- **Endpoint** `GET /api/db/mode` (status mode aktif) & `POST /api/db/mode`
  (switch runtime), dengan validasi mode + guard ketersediaan tiap mode.
- Helper `pgConfigFor` / `cloudUrl` / `describeTarget` / `dbStatus`; `/api/v1/status`
  dan WS `hello` kini melaporkan mode DB aktif.
- Env baru: `DB_MODE` (default `local`) & `SUPABASE_DB_URL` (`.env.example`).

### 🔒 Fixed — Konkurensi & Koneksi Cloud

- **SSL Supabase**: `sslmode` di-strip dari connection string + `ssl: { rejectUnauthorized: false }`
  supaya cert pooler diterima (sebelumnya gagal `self-signed certificate in chain`).
- **LISTEN/NOTIFY**: `cloudUrl()` memprioritaskan connection string port `:5432`
  (session pooler) di atas `:6543`; peringatan keras kalau dipakai pooler `:6543`
  (transaction/pgbouncer) yang tidak mendukung LISTEN/NOTIFY.
- **Race condition**: `initPostgres` / `setupPgListener` memakai pola *local-commit*
  + generation guard — pool/client dibangun di variabel lokal, commit ke global
  hanya setelah ping sukses & generation cocok. Mencegah stale init meng-clobber
  pool yang lebih baru, leak pool, atau state `pgReady=true` tapi `pgPool=null`.
- **Pool leak**: pool ditutup saat skema tidak ada / init gagal (tidak dibiarkan
  menggantung saat `initPostgres` dipanggil ulang).
- Switch konkuren diserialisasi via flag `switching` (request kedua → HTTP 409).

### ✨ Added — Operator Edge UX (`vps-dashboard`)

- **`OperatorLaunchButton`**: deteksi kalau dashboard diakses dari origin non-lokal
  (mis. Vercel) tapi Edge URL masih `localhost` → tampilkan peringatan jelas +
  tombol *"Tetap buka"*, alih-alih membuka tab yang loading selamanya. Default
  Edge URL tetap `http://localhost:3000`.

### 🔧 Changed

- `.gitignore`: abaikan `data/db_mode.json` (runtime state, machine-specific).

---

## [2.5.0] — 2026-05-11

### 🎯 Tema rilis: Segmentation Pipeline Upgrade — ISNet + Alpha-Matting + Shadow Removal + Async Inference Worker + GPU Acceleration (CoreML / DirectML / CUDA)

Versi ini fokus **comprehensive overhaul** pipeline `rembg` di
`edge_camera.py`: dari mask kasar single-model CPU-only menjadi pipeline
multi-stage edge-refined dengan hardware acceleration & async inference.
Tujuan: kualitas mask mendekati `remove.bg` (commercial), tetap real-time
di laptop tanpa GPU diskrit.

**Backwards-compatible 100%** dengan v2.4.0:
- Pipeline kalibrasi (`cornerSubPix` + KTP 85.6×53.98mm scaling) **0%
  disentuh** — akurasi sub-millimeter tetap presisi identik dengan v2.0.0.
- Semua perubahan defaults-on dengan env-var override; fallback otomatis
  ke `_dominant_color_mask` kalau `rembg` tidak terinstall (sama seperti
  sebelumnya).
- API `extract_measurement()` signature tidak berubah; consumer (web
  dashboard, JSON storage, PostgreSQL sync) tidak butuh migrasi.

Motivasi: pengguna ingin (a) mask quality yang **konsisten** dengan
preview cloud tools (remove.bg-grade), (b) bayangan tidak ke-include di
mask karena bikin L/W ke-inflated, (c) main loop tetap smooth di camera
FPS meski model lebih besar (178 MB ISNet vs 5 MB U2NetP), (d) leverage
hardware (Apple Neural Engine di M-series Mac, GPU di Windows/NVIDIA)
otomatis tanpa rebuild manual.

### ✨ Added — Model Upgrade & Edge Refinement

- **Model default**: `u2netp` (~5 MB) → `isnet-general-use` (~178 MB).
  - Edge mendekati `remove.bg`, well-tested 2022, stabil frame-to-frame
    (no flicker pada pengukuran berulang).
  - Override: `REMBG_MODEL=<u2netp|isnet-general-use|birefnet-general-lite|birefnet-general>`
  - Trade-off matrix:
    | Model | Size | Quality | Speed (CPU) | Use case |
    | --- | --- | --- | --- | --- |
    | `u2netp` | 5 MB | Kasar | Cepat | Raspberry Pi, low-disk |
    | `isnet-general-use` | 178 MB | Tinggi | Sedang | **Default — sweet spot** |
    | `birefnet-general-lite` | 178 MB | Edge halus | Lambat (CPU) | Detail tepi prioritas |
    | `birefnet-general` | 880 MB | SOTA | Real-time hanya GPU | High-end workstation |

- **Alpha matting** (trimap-based edge refinement):
  - Sub-pixel edge positioning untuk kontur kompleks (mirip `remove.bg`
    pada objek ber-tepi halus seperti rambut/serat plastik).
  - Threshold `FG=240` / `BG=10` / `erode=10` mengikuti rekomendasi
    rembg untuk general objects.
  - Cost: 3-5x lebih lambat per frame (di-offset oleh async worker).
  - Override: `REMBG_ALPHA_MATTING=0` untuk disable (gain FPS di Pi).

### ✨ Added — Shadow Removal (Chromaticity-Similarity Test)

- **`_remove_shadow_from_mask(frame, mask)`** — algoritma baru:
  - Cast shadow di tepi mask di-reject via HS-distance ke object-core
    vs background-ring.
  - Run **BEFORE** morphological sealing — kalau sesudah, shadow sudah
    ke-bake jadi outline solid dan tidak bisa di-remove lagi.
  - Skip otomatis kalau object & background HS-similar (avoid false
    positive: objek putih di meja putih).
  - Idempotent untuk objek tanpa shadow: boundary HS mirip core (bukan
    bg) → tidak ada pixel yang di-flag.
- Override: `REMBG_SHADOW_REMOVAL=0`.

### ✨ Added — Hardware Acceleration (Auto-Select ONNX Provider)

- **`_select_providers()`** — platform-aware execution provider selection:
  - **macOS (M-series)** → CoreML (Apple Neural Engine) — 2-3x speedup
  - **Windows GPU** → DirectML (any vendor: NVIDIA / AMD / Intel) — 3-5x speedup
  - **Linux + NVIDIA** → CUDA — 5-10x speedup (memerlukan `onnxruntime-gpu`)
  - **Fallback** → CPU dengan warning kalau provider yang diminta tidak
    tersedia (mis. user di Windows tapi belum install
    `onnxruntime-directml`).
- Override: `REMBG_PROVIDER=auto|cpu|coreml|dml|cuda`.
- `requirements.txt` di-update dengan dokumentasi 3 provider option:
  - `onnxruntime` (default, all platforms, CoreML otomatis di Mac)
  - `onnxruntime-directml` (uncomment untuk Windows GPU)
  - `onnxruntime-gpu` (uncomment untuk NVIDIA CUDA)

### ✨ Added — Async Inference Worker (`AsyncMeasurer`)

- **Worker thread** jalanin `extract_measurement()` di background:
  - Main loop submit frame terbaru via `submit(frame)` non-blocking.
  - Worker pull frame terakhir saja (drop frame lama) — **latest-wins
    semantics**.
  - `latest()` return `(result_tuple, seq)` — caller cek `seq` berubah
    sebelum feed ke smoother (mencegah duplikat sample yang bias median
    window).
  - Display tetap render di camera FPS (~30) meski inference 100-300ms
    per frame.
  - Stale frame 1-3 frame: invisible untuk inspeksi rigid object (objek
    diam saat diukur).
- Override: `REMBG_ASYNC=0` untuk sync mode (debugging).
- EMA inference latency tracking (`0.7 * old + 0.3 * new`) untuk HUD.

### ✨ Added — Inference Downsampling

- Default downsample input ke **768px long-side** sebelum dikirim ke
  ONNX session, mask di-upscale balik ke full-res sebelum threshold +
  morph.
- Rationale: rembg internal-resize ke 320×320 (ISNet) atau 1024×1024
  (BiRefNet) anyway — feed 1920×1080 cuma buang waktu di preprocess.
- Speedup 3-5x tanpa loss akurasi pengukuran (mask edge sedikit lebih
  halus karena hilang noise high-freq).
- Override: `REMBG_INFERENCE_MAX_SIDE=N` (set `0` untuk native resolution).

### ✨ Added — Local Model Cache

- Model dicache di **`./models/rembg/`** (bukan default `~/.u2net/`).
- Konsekuensi:
  - Model travels with repo — tidak perlu re-download saat pindah mesin.
  - `U2NET_HOME` di-set di top-level **sebelum** `import rembg` (rembg/
    pooch baca env var saat init, bukan saat call).
  - `models/` di `.gitignore` (tidak commit ke git, tapi predictable
    location).

### ✨ Added — `LoadingProgress` + Eager Preload

- **`LoadingProgress`** class — animated terminal progress bar:
  - Spinner braille (10-frame `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) update tiap 100ms via
    background thread.
  - Milestone-based: setiap stage punya start/finish jelas dengan elapsed
    time per stage + total.
  - Context manager pattern: `with LoadingProgress("title") as p: p.stage(...)`.
  - Auto-detect TTY: non-TTY (piped) fallback ke plain `• stage...` line.
- **`preload_rembg_session()`** — eager-load + warmup di `main()`
  sebelum `cap.open()`:
  - User dapat feedback visual selama 5-15s startup (bukan freeze silent).
  - Warmup inference (`_rembg_mask` di dummy 64×64 frame) bayar JIT cost
    di depan — saving ~500-1500ms di first frame inspection loop.
- Output sample:
  ```
  [REMBG] Loading isnet-general-use...
     ✓ Checking model cache  (cached: 178.3 MB at ./models/rembg/)  0.0s
     ✓ Initializing ONNX session (CoreML (Apple Neural Engine))  4.5s
     ✓ Warmup inference (pay JIT cost up front)  1.1s
     ✓ Pipeline ready — alpha-matting ON  0.0s
     → Ready (total: 5.6s)
  ```

### ✨ Added — HUD FPS + Inference Latency Overlay

- Real-time FPS counter di pojok kanan-atas display:
  - Color-coded: hijau ≥25 FPS / kuning ≥15 / merah <15.
  - Rolling window 30-sample timestamp (≈1 detik di 30 FPS).
- Inference latency badge di bawahnya: `inf 234ms` (rolling EMA).
- Membantu user verifikasi async path bekerja: display FPS independent
  dari inference latency.

### 🔧 Changed — Banner Output di Startup

- Banner segmentasi di-expand jadi 6 baris info:
  ```
  Segmentasi : rembg / isnet-general-use + alpha-matting @768px
  Provider   : CoreML (Apple Neural Engine)  (override: REMBG_PROVIDER=...)
  Pipeline   : async (worker thread)
  Model dir  : ./models/rembg/ (cached, tidak download ulang)
  Override   : REMBG_MODEL=<name>  REMBG_ALPHA_MATTING=1
               REMBG_INFERENCE_MAX_SIDE=N (0=native)  REMBG_ASYNC=0
  ```
- Fallback message diperbaiki: `install rembg untuk kualitas mirip
  remove.bg` (sebelumnya generic "kualitas lebih baik").

### 📦 Dependencies & Files

| File | Change | Nature |
| --- | --- | --- |
| `edge_camera.py` | +614 / −45 | ISNet/alpha-matting/shadow/async/GPU/preload/HUD |
| `requirements.txt` | +22 / −2 | Multi-provider ONNX runtime documentation |
| `.gitignore` | +3 / −0 | Exclude `models/` directory |
| `package.json` | bump | 2.4.0 → 2.5.0 |
| `package-lock.json` | bump | 2.4.0 → 2.5.0 |

### ⚙️ Environment Variables (New)

| Var | Default | Purpose |
| --- | --- | --- |
| `REMBG_MODEL` | `isnet-general-use` | Model selection |
| `REMBG_ALPHA_MATTING` | `1` | Trimap edge refinement on/off |
| `REMBG_SHADOW_REMOVAL` | `1` | Chromaticity shadow rejection on/off |
| `REMBG_INFERENCE_MAX_SIDE` | `768` | Downsample for inference (`0`=native) |
| `REMBG_ASYNC` | `1` | Worker thread on/off |
| `REMBG_PROVIDER` | `auto` | `auto`/`cpu`/`coreml`/`dml`/`cuda` |
| `U2NET_HOME` | `./models/rembg/` | Model cache directory (auto-set) |

### 🧪 Migration Notes (v2.4.0 → v2.5.0)

- **Tidak ada perubahan API**: web dashboard, JSON storage, PostgreSQL
  sync, WebSocket protocol — semua identik.
- **First run**: download `isnet-general-use.onnx` ~178 MB ke
  `./models/rembg/` (sekali saja). Untuk environment offline atau
  bandwidth limited, override ke `REMBG_MODEL=u2netp` (5 MB).
- **Pengguna existing dengan `~/.u2net/u2netp.onnx`**: cache lama tidak
  dipakai (path baru `./models/rembg/`). Bisa dihapus manual, atau
  override `REMBG_MODEL=u2netp` + `U2NET_HOME=~/.u2net` untuk reuse.
- **Windows GPU users**: untuk akselerasi DirectML, jalankan:
  ```
  pip uninstall onnxruntime
  pip install onnxruntime-directml
  ```
  lalu set `REMBG_PROVIDER=dml`.
- **Validasi tidak ada regresi pengukuran**: bandingkan output L/W
  sebelum/sesudah upgrade pada KTP referensi (85.6×53.98mm) — harus
  identik dalam toleransi sub-pixel ±0.05mm.

---

## [2.4.0] — 2026-05-07

### 🎯 Tema rilis: VPS Multi-Role Dashboard (Next.js) + Live Camera Streaming + Export & Audit Log

Versi ini memperkenalkan **3 capability besar** sekaligus, semuanya
backwards-compatible dengan v2.3.0 / v2.2.0:

1. **Live Camera Streaming ke web** — frame `edge_camera.py` (lengkap
   dengan HUD overlay tracking) dapat di-monitor live di dashboard via
   WebSocket binary JPEG. 12 keybind hotkey + 3 wizard button (Y/N/ESC)
   bisa ditekan dari web — semua fase termasuk wizard kalibrasi visible
   end-to-end.
2. **VPS Multi-Role Dashboard** (Next.js 14 + NextAuth.js v5 + Prisma) —
   subfolder `vps-dashboard/` self-contained, deploy-ready (PM2 + Nginx +
   Let's Encrypt). 3 role hierarchy: **operator** (live cam + redirect ke
   local edge), **supervisor** (data + chart + export), **manager** (full
   + admin user CRUD + audit log).
3. **Export Data multi-format & Audit Log** — Supervisor + Manager dapat
   export CSV/Excel/PDF dengan banyak opsi (mode flat/grouped, range
   tanggal, filter aktif, multi-select objek, variabel-pilih). Manager
   dapat akses audit trail sistem (login activity, CRUD users, export
   events) di `/admin/audit`.

**Konstrain pipeline kalibrasi**: `edge_camera.py` measurement/cornerSubPix/
sub-pixel pipeline **0% disentuh**. Streaming integration cuma 24 LOC di
2 spot terisolasi (top-level import + main loop hook). Akurasi sub-millimeter
KTP 85.6×53.98mm tetap presisi identik dengan v2.0.0.

Motivasi: pengguna ingin (a) operator/supervisor/manager workflow
terpisah dengan akses berbeda, (b) live monitoring kamera dari laptop
remote (dengan tetap menjaga TOS rumahweb yang melarang relay video di
VPS — solusinya stream LAN-only, data sync ke VPS), (c) export laporan
formal untuk dosen/manager dengan format Indonesia, (d) audit governance
untuk compliance.

### ✨ Added — Live Camera Streaming (`stream/` Python package)

- **`stream/publisher.py`** — `WSPublisher` class yang menjalankan
  asyncio WebSocket server di port `:8765` di thread terpisah. Frame
  dipush via single-slot queue (newest wins), encode JPEG q80 di async
  loop, broadcast ke semua client connected. Per-client backpressure
  drop pakai `asyncio.wait_for(ws.send(...), timeout=0.05)` — client
  lemot tidak blocking yang lain.
- **`stream/control.py`** — `WSControl` class di port `:8766` terima
  JSON `{"key": "SPACE"}` dari browser, translate ke ord int via
  `KEY_MAP` (16 key: SPACE/A/C/D/L/Q/R/U/V/X/Y/N/[/]/ENTER/ESC), push
  ke single-slot queue.
- **`stream/config.py`** — env-overridable: `STREAM_PORT`, `CONTROL_PORT`,
  `STREAM_BIND`, `STREAM_MAX_WIDTH` (default 1920 = 1080p pass-through),
  `STREAM_QUALITY` (default 80), `STREAM_FPS_TARGET` (default 30).
- **`stream/__init__.py`** — public API `start()`, `stop()`,
  `publish(frame)`, `poll_key()`. Lazy-init.
- **`stream/__main__.py`** — `python -m stream` standalone debugger
  tanpa edge_camera (capture kamera 0, publish ke browser).

#### `edge_camera.py` integration (24 LOC, 2 spot terisolasi)

- **Top-level import block** (3 LOC): try-import stream + start helpers
  `_stream_publish()` dan `_stream_poll_key()` (fail silent kalau modul
  tidak tersedia).
- **Main loop hook** (~9 LOC sekitar `cv2.imshow + cv2.waitKey`):
  publish `display` frame ke web + accept web key kalau tidak ada
  keypress fisik.
- **Wizard kalibrasi** ([_wizard_phase_ktp]): publish `ann` frame loop +
  `confirm` dialog Y/N + `busy` notice — semua tahapan visible di web.
  Confirm dialog `cv2.waitKey(0)` blocking → polling `cv2.waitKey(50)` +
  cek web key. Web user tekan tombol Y/N/ESC di sub-row → flow yang
  sama persis jalan.
- **Notice prompt** "switch to terminal" (2 spot di main loop) → publish
  juga supaya operator tahu R-key triggered.

#### Frontend live camera (`script.js`, `index.html`, `style.css`)

- **`<canvas id="live-cam-canvas">`** dengan `createImageBitmap()` +
  `requestAnimationFrame` + drop-stale frame. Anti-jitter engineering:
  `desynchronized: true`, single-slot client-side queue.
- **WS reconnect** exponential backoff 1s→30s, status indicator (online
  pulsing hijau, offline abu).
- **FPS badge** di pojok kanan canvas update setiap detik dari rolling
  per-second count.
- **12 keybind buttons** (SPACE/A/C/R/U/L/V/[/]/X/D/Q) dengan icon +
  shortcut chip + label, click → POST control WS → inject ke key queue
  Python. Visual feedback `keybindPulse` animation.
- **Sub-row 3 wizard buttons** (Y/N/ESC) untuk confirm dialog wizard
  kalibrasi — visible kapan saja, situational.

### ✨ Added — Local Web UX Refresh (Sidebar + Topbar + Footer)

- **`theme.css`** — single source of truth design tokens: 6 background
  layer, 2 border, 4 accent (blue/cyan + glow), 6 status (ok/ng + bg),
  3 role accent (operator cyan, supervisor blue, manager purple), 3
  text level, typography, 4 radius, 3 layout size, 2 transition, 3
  shadow, 5 z-index. Loaded **before** `style.css` di `index.html`.
- **`index.html` restructured** — `app-shell` grid 2 kolom:
  * Sidebar fixed kiri 240px (sticky di desktop ≥900px, off-canvas
    drawer dengan transform translateX di mobile).
  * Main content dengan topbar sticky + page-content + footer.
  * Sidebar nav: 5 items (Live Camera, Statistik, Klasifikasi,
    Distribusi, Riwayat) dengan smooth scroll anchor.
  * User card di footer sidebar dengan avatar + name + role badge +
    logout button.
- **`style.css`** +700 LOC: app-shell grid, sidebar drawer + brand +
  nav-item + active state cyan accent, topbar sticky + clock + WS
  indicator, hamburger toggle mobile-only, page-content max-w-1400px,
  live-camera-section dengan canvas wrap + placeholder + meta badges,
  keybind-grid 4/6/12 col responsive + hover state per variant, wizard
  sub-row dashed separator, FPS badge + stream status pulse animation.
- **Sidebar interaction** sesuai preference user:
  * Hover/focus state DI-DISABLE (transparent + outline:none).
  * Scroll-spy IntersectionObserver DIHAPUS — active state hanya
    berubah saat klik manual.
  * Active highlight: cyan accent bar 3px di kiri + bg-tint cyan.

### ✨ Added — Local Auth Bridge (Phase 2)

- **`server.js` JWT helpers**:
  * `JWT_SECRET` config dari env (shared dengan VPS Next.js
    `NEXTAUTH_SECRET` — secret sama → token bisa cross-verify).
  * `signToken(payload, expiresIn)` HS256 default 24h.
  * `verifyToken(token)` validate signature + expiry + role.
  * `GET /api/auth/config` — frontend dapat URL VPS login + valid roles.
  * `POST /api/auth/verify` — terima `{token}` → return `{user, expiresAt}`
    atau 401.
  * `GET /api/auth/dev-token?role=...&name=...` — issue test token
    tanpa Next.js (gated by `ALLOW_DEV_TOKEN=true`).
- **`script.js initAuth()`** — pipeline: fetch config → cek `?token=`
  URL → store ke localStorage + cleanup URL via `history.replaceState`
  → validate via `/api/auth/verify` → update sidebar user card +
  role-based UI gating (`applyRoleGating` hide live-cam section
  kalau role !== operator).

### ✨ Added — VPS Next.js Dashboard (`vps-dashboard/`)

#### Stack & Build

- **Next.js 14.2.18** App Router (TypeScript) + `output: 'standalone'`
  (PM2 + Nginx ready)
- **NextAuth.js v5 beta** dengan Credentials provider + JWT session
  strategy + Prisma Adapter
- **Prisma 5.22** + PostgreSQL (shared dengan local PG di dev,
  separate di production)
- **Tailwind CSS 3.4** dengan theme yang mirror `theme.css` shared
- **bcryptjs**, **zod** validation, **jsonwebtoken** (signing edge
  redirect token), **lucide-react** icons
- **Chart.js 4.5** + **react-chartjs-2** untuk DistributionChart
- **xlsx 0.18** + **jspdf 4.2** + **jspdf-autotable 5.0** untuk export

#### Database Schema (Prisma)

- **`User`** dengan `Role` enum (operator/supervisor/manager) + `email`
  unique + `password` bcrypt hash + `edge_url` (untuk operator redirect)
  + standard NextAuth fields.
- **`Account`**, **`Session`**, **`VerificationToken`** — NextAuth adapter
  tables.
- **`AuditLog`** dengan `AuditAction` enum 8 jenis (user_created/updated/
  deleted, user_login/login_failed/logout, data_exported,
  inspection_deleted) + actor snapshot (id/email/role) + target +
  metadata JSON + ipAddress + userAgent + indexed on createdAt(desc).
- **`Inspection`** mirror dengan **type-aligned** ke local PG schema:
  `dimension_mm/width_mm/confidence` sebagai `DoublePrecision`,
  `timestamp` sebagai `Timestamptz(6)` — supaya Prisma `db push` tidak
  alter existing column types (yang akan break view `v_inspection_summary`).

#### Layout Components (Responsive)

- **`AppShell`** client component — manage sidebar drawer state.
  Auto-close on route change (usePathname effect), Esc key handler,
  body scroll lock saat drawer open.
- **`Sidebar`** — drawer di mobile (`<md`) dengan transform translateX
  + close button X di brand area. Sticky di desktop (`md+`).
  Role-aware nav items (Live Camera operator-only, Manage Users + Audit
  Log manager-only).
- **`Topbar`** — hamburger button mobile-only, title gradient, live
  clock dengan format Indonesia, user info hidden di mobile.
- **`Footer`** baru — credit Capstone A3 + Filkom UB + version v2.4.0
  + tahun. Stack vertikal mobile, horizontal tablet+.
- **Backdrop** mobile dengan `bg-black/60 backdrop-blur-sm` saat drawer
  open. Click → close.

#### Pages

- **`/login`** — credentials form dengan quick-fill demo buttons (3 role
  warna-coded). Redirect ke `/dashboard` setelah login. Logged-in user
  yang akses `/login` auto-redirect ke `/dashboard`.
- **`/dashboard`** — full UI:
  * `StatsGrid` 5 cards (Total/GOOD/NOT GOOD/% rates) responsive 2/3/5
    col.
  * `DistributionChart` Chart.js bar dengan dark theme styling.
  * `GroupedClassificationTable` mode toggle Dikelompokkan ↔ Semua
    (flat per-inspeksi) + filter search + sortable headers + 7 kolom
    termasuk **Terakhir** (relative time format Indonesia: "5 mnt lalu")
    + pagination 10/halaman.
  * `InspectionTable` filter + sort + pagination, **format waktu
    Indonesia** ("4 Mei 2026, 14.30") via `Intl.DateTimeFormat('id-ID')`.
  * **Export button** muncul di header untuk supervisor + manager
    (operator hidden).
- **`/admin`** (manager only) — `UserManagementTable` CRUD dengan inline
  edit (name + role + password), cegah self-delete, `AddUserForm`
  dengan **role picker (3 role)** + `edge_url` field (opsional, hanya
  saat role=operator).
- **`/admin/audit`** (manager only) — `AuditLogTable` paginated dengan
  filter action dropdown (8 jenis) + actor email search debounce + IP
  address column + metadata summarized inline (mis. user_updated
  display "role: operator → manager").
- **`/operator`** (operator only) — `OperatorLaunchButton`: POST
  `/api/auth/issue-edge-token` → dapat JWT 15min → buka tab baru
  `${edgeUrl}/?token=${jwt}` → local server.js auto-validate via
  `/api/auth/verify` → grant operator UI access (live cam + keybind).

#### API Routes

- **`POST /api/auth/issue-edge-token`** — operator only, issue JWT 15min
  short-lived dengan secret yang sama dengan local server.js JWT_SECRET.
- **`GET /api/users`** + **`POST /api/users`** — manager only, zod
  validation + bcrypt + email uniqueness check. Audit logged.
- **`PATCH /api/users/[id]`** — manager only, diff metadata from→to
  ditulis ke audit log.
- **`DELETE /api/users/[id]`** — manager only, cegah self-delete +
  audit log dengan target snapshot.
- **`GET /api/audit?page=&pageSize=&action=&actor=&from=&to=`** —
  manager only, paginated dengan filter.
- **`GET /api/export?format=&mode=&fields=&search=&status=&from=&to=&objects=`**
  — supervisor + manager, binary stream response dengan
  Content-Disposition attachment filename Indonesia-friendly
  (`inspeksi-flat-2026-05-07-1430.csv`).

#### Middleware (Route Protection)

- **`middleware.ts`** — protect `/dashboard`, `/admin/*`, `/operator`
  via NextAuth `auth()`. Role-based redirect: non-manager akses
  `/admin/*` → redirect `/dashboard`; non-operator akses `/operator` →
  redirect `/dashboard`.

### ✨ Added — Export Data Multi-Format (Supervisor + Manager)

- **`ExportMenu`** modal dengan banyak opsi:
  * **Format**: CSV (UTF-8 BOM Excel-compat) / Excel (.xlsx auto-width
    + title row) / PDF (light theme A4 landscape, native chart drawn
    dengan jsPDF primitives).
  * **Mode**: Flat (per inspeksi) / Grouped (klasifikasi per objek).
  * **Range tanggal**: Semua / Hari Ini / 7 Hari / 30 Hari / Custom
    (datetime-local).
  * **Filter aktif** checkbox: sesuaikan dengan filter tabel
    (search + status). Multi-select objek picker dengan distinct list +
    count per nama.
  * **Variabel** (flat mode): 7 checkbox kolom (default semua dipilih).
  * **Live count preview**: "N baris akan di-export" dengan kalkulasi
    semua filter aktif.
- **`lib/export-csv.ts`** — RFC 4180 escaping + UTF-8 BOM untuk
  Excel-compat membaca karakter Indonesia (é/ô/dst).
- **`lib/export-xlsx.ts`** — `xlsx` library, auto-width column berdasar
  max content length (clamp 8-40 chars).
- **`lib/export-pdf.ts`** — light theme print-friendly:
  * Header band cyan (#0891b2) dengan title white + meta export info.
  * Summary stats card 5 KPI dengan **color tone per metric**
    (Total=cyan, GOOD=hijau, NG=merah, % GOOD/NG color-coded).
  * **Native bar chart** drawn via jsPDF primitives (no extra dep):
    - **Flat mode** = vertical 2-bar GOOD/NOT GOOD dengan count + percentage
      label.
    - **Grouped mode** = horizontal stacked bar top 8 objek by volume
      dengan inline GOOD/NG count + total di kanan, legend di header.
  * Tabel data via jspdf-autotable dengan zebra row + status cell
    color-coded.
  * Footer separator line + halaman X dari Y + credit Capstone.
- **`lib/export-shared.ts`** — type definitions (ExportFormat,
  ExportMode, ExportField) + data shapers (`shapeFlat`, `shapeGrouped`)
  + `formatTimestampID` (Indonesian format) + `buildFilename`
  (timestamped naming).

### ✨ Added — Audit Log (Manager Only)

- **8 trigger points** wired ke existing endpoints:
  * `POST /api/users` → `user_created` dengan email/name/role metadata.
  * `PATCH /api/users/[id]` → `user_updated` dengan **diff metadata**
    (mis. `{ role: { from: 'operator', to: 'manager' } }`).
  * `DELETE /api/users/[id]` → `user_deleted` dengan target snapshot.
  * `NextAuth.authorize()` success → `user_login`.
  * `NextAuth.authorize()` fail → `user_login_failed` dengan reason
    (3 jenis: invalid input format, user not found, wrong password).
  * `events.signOut()` → `user_logout`.
  * `GET /api/export` → `data_exported` dengan format/mode/filters/
    rowCount/filename.
- **Captured**: actor (id/email/role snapshot — tetap kebaca walau
  user di-delete), target (type/id), metadata JSON, ipAddress
  (X-Forwarded-For-aware), userAgent, createdAt.
- **`AuditLogTable`** UI dengan emoji + warna per action type (login
  cyan, login_failed merah, deleted merah, exported blue, dst.) +
  metadata summarized inline + IP address column + pagination.

### ✨ Added — PM2 Deployment Config (`ecosystem.config.js`)

- **3 services**:
  * `capstone-server` — Express + WebSocket di port 3000 (REST + WS
    realtime + dashboard local).
  * `capstone-edge` — Python `edge_camera.py` + stream module di port
    8765 + 8766.
  * `capstone-vps` — Next.js standalone build di port 3001
    (`./vps-dashboard/.next/standalone/server.js`).
- Per-service: `autorestart`, `max_restarts`, `min_uptime`,
  `max_memory_restart`, env vars, log paths (`./logs/<name>.{err,out}.log`),
  `merge_logs: true`, `time: true`.
- Production deploy: `pm2 start ecosystem.config.js && pm2 save && pm2 startup`.

### 📦 Added — Dependencies

#### Root (`package.json`)

| Library | Version | Reason |
| --- | --- | --- |
| `jsonwebtoken` | `^9.0.3` | JWT sign/verify untuk auth bridge dengan VPS Next.js |

#### Stream module (`requirements.txt`)

| Library | Version | Reason |
| --- | --- | --- |
| `websockets` | `>=12.0` | Pure-Python WS server di publisher + control. No native deps. |

#### VPS Next.js (`vps-dashboard/package.json`)

| Library | Version | Reason |
| --- | --- | --- |
| `next` | `^14.2.18` | App Router framework |
| `react`, `react-dom` | `^18.3.1` | UI runtime |
| `next-auth` | `5.0.0-beta.25` | Authentication library |
| `@auth/prisma-adapter` | `^2.7.4` | Prisma adapter untuk NextAuth session/account tables |
| `prisma`, `@prisma/client` | `^5.22.0` | ORM. v5.x karena v6/7 deprecated `url` di datasource block |
| `bcryptjs` | `^2.4.3` | Password hashing |
| `jsonwebtoken` | `^9.0.2` | Sign edge redirect token (compatible dengan local server.js) |
| `zod` | `^3.23.8` | Validation user input |
| `lucide-react` | `^0.460.0` | Icon set |
| `tailwindcss`, `postcss`, `autoprefixer` | `^3.4.15` | Styling |
| `chart.js`, `react-chartjs-2` | `^4.5.1`, `^5.3.1` | Distribution chart |
| `xlsx` | `^0.18.5` | Excel export |
| `jspdf`, `jspdf-autotable` | `^4.2.1`, `^5.0.7` | PDF export dengan native chart drawing |
| `tsx` | `^4.19.2` (dev) | Run prisma seed.ts |

### 🔄 Changed

- **`edge_camera.py`** — wizard kalibrasi confirm dialog
  `cv2.waitKey(0)` blocking → polling `cv2.waitKey(50)` + cek web key.
  Equivalent semantik: setelah Y/N/ESC ditekan (fisik atau web),
  branch logic kalibrasi yang dieksekusi **identik bit-for-bit**.
  Pipeline `ppmm_avg`, cross-cal averaging, sigma rejection,
  `save_calibration` tidak diubah satu baris pun.
- **`script.js`** — sidebar nav: scroll-spy IntersectionObserver
  DIHAPUS, active state hanya berubah saat klik manual (sesuai
  request user supaya focus tidak berubah saat scroll).
- **`style.css`** sidebar `.nav-item` — hover/focus state
  di-disable (transparent + outline:none).
- **VPS dashboard** — Indonesian date format (`Intl.DateTimeFormat
  ('id-ID')`) di kolom Waktu InspectionTable, kolom Terakhir
  GroupedClassificationTable (relative format "5 mnt lalu"), AuditLog
  Waktu, Export filename, Export PDF meta info.

### 🛠 Fixed

- **Border color tabel VPS dashboard** — sebelumnya `border-border/40`
  Tailwind tidak resolve opacity untuk CSS-variable-based color, fall
  back ke `currentColor` putih di dark mode → garis putih ngebok.
  Sekarang: global CSS `* { border-color: var(--border) }` + class
  `.row-divider` dengan rgba precomputed (40% dari `#1e3a5f`).
- **Klasifikasi table center alignment** — VPS dashboard kolom
  numerik sekarang center-aligned (header & value sejajar). Mirror
  fix yang sudah ada di local web.
- **`.history-section { overflow: hidden }`** local web — REMOVED
  karena nge-clip dropdown filter object panel. Trade-off
  corner-radius clipping handled di `.table-wrapper`.
- **Chart.js v4 BarController registration** — VPS dashboard
  Chart.tsx wajib `ChartJS.register(BarController, ...)` (tidak cuma
  BarElement) supaya `type: 'bar'` recognized.
- **Prisma db push dengan view dependency** — initial push gagal
  karena Prisma mencoba alter `inspections.timestamp` type yang
  dipakai view `v_inspection_summary`. Fix: explicit
  `@db.Timestamptz(6)` + `@db.DoublePrecision` pada Inspection model
  → match existing PG schema → no alter triggered.
- **Next.js standalone build** export-pdf.ts — TypeScript spread
  readonly tuple ke `setTextColor(r,g,b)` rejected. Fix: type RGB
  sebagai mutable `[number, number, number]`.

### 🔒 Untouched (zero touch sesuai konstrain capstone)

`edge_camera.py` calibration & measurement pipeline **0% diubah**:

- `Config.PIXELS_PER_MM_L`, `Config.PIXELS_PER_MM_W` (anisotropic ppmm)
- `save_calibration` / `load_calibration`
- `calibration_wizard` + `_wizard_phase_ktp` core (KTP detection,
  4-stage lock, cross-cal averaging, sigma rejection)
- `_refine_rect_corners` + `cv2.cornerSubPix` (sub-pixel refinement)
- `_rembg_mask`, `_dominant_color_mask`, `_detect_skin_mask`
- MORPH_CLOSE 21×21 + RETR_EXTERNAL fill (sealing pipeline)
- `extract_measurement`, `evaluate_status`, `score_contour`,
  `draw_overlay`, `draw_hud`
- `ObjectCatalog` logic + Live-Cal mode

Yang ditambah cuma jalur **visualisasi sekunder** (publish frame ke
web) + **input alternatif** (web keypress equivalent dengan fisik).
24 LOC di 2 spot terisolasi. Akurasi sub-millimeter KTP 85.6×53.98mm
**identik bit-for-bit** dengan v2.0.0/v2.1.0/v2.2.0/v2.3.0.

### ⚠️ Migration Notes — Untuk Yang Upgrade dari v2.3.0

- **`requirements.txt`** baru tambah `websockets>=12.0`. Run `pip install
  -r requirements.txt` ulang.
- **`vps-dashboard/`** subfolder baru. Run setup-nya:
  ```bash
  cd vps-dashboard
  npm install
  cp .env.example .env       # edit DATABASE_URL + NEXTAUTH_SECRET
  npx prisma db push          # schema NextAuth + AuditLog ditambahkan
  npm run prisma:seed         # 3 demo users
  npm run dev                 # http://localhost:3001
  ```
- **`JWT_SECRET` di `.env`** root **harus sama** dengan
  `NEXTAUTH_SECRET` di `vps-dashboard/.env` supaya operator redirect
  token cross-verify.
- **PostgreSQL**: AuditLog + User/Account/Session/VerificationToken
  tables ditambahkan (additive, tidak alter inspections).
- **Operator demo akun**: `operator@capstone.dev` / `operator123`
  (login VPS → tombol launch → buka tab local edge dengan token).
  Ganti password setelah deploy production.
- **API kompatibel** dengan v2.3.0 — POST `/inspection` tetap terima
  legacy `OK/NG` dan canonical `GOOD/NOT GOOD`.

### ✅ Verified

- 3 role login flow (operator/supervisor/manager) dengan middleware
  route protection (live-tested via curl).
- CRUD users + role validation (zod) + cegah self-delete.
- Export 6 kombinasi (CSV/XLSX/PDF × flat/grouped) — file size & type
  verified (CSV 6.7KB, XLSX "Microsoft Excel 2007+", PDF 220KB
  "PDF document, version 1.3").
- Audit log capture 7 jenis action dengan diff metadata + filter
  pagination.
- Live camera streaming end-to-end (frame WS publisher + control WS
  keybind round-trip Y/N/ESC verified).
- `npm run build` Next.js sukses (output standalone), `node --check`
  pass untuk server.js dan script.js, `py_compile` pass untuk
  edge_camera.py.

### 📦 Files added/modified

| File | Change | Nature |
| --- | --- | --- |
| `theme.css` | new | Shared design tokens (single source of truth) |
| `stream/__init__.py`, `__main__.py`, `config.py`, `publisher.py`, `control.py` | new | WS streaming module Python |
| `ecosystem.config.js` | new | PM2 config 3 services |
| `sim.html` | new | Photobox 3D simulator (experimental) |
| `vps-dashboard/` | new (49 files) | Next.js 14 app dengan Auth + Prisma + UI components |
| `edge_camera.py` | +24 LOC | Streaming hooks (2 spot terisolasi) |
| `index.html` | +239/-22 | App-shell + sidebar + topbar + footer + live cam section + 12+3 keybind buttons |
| `script.js` | +697/-30 | Live cam client + auth init + sidebar handlers + role gating |
| `server.js` | +124 LOC | JWT helpers + 3 auth endpoints |
| `style.css` | +694/-22 | Sidebar + topbar + keybind grid + live cam + responsive |
| `requirements.txt` | +6 | websockets dep |
| `package.json` | +1 dep | jsonwebtoken |
| `package-lock.json` | sync | npm install |
| `.env.example` | +15 | JWT_SECRET, VPS_LOGIN_URL, ALLOW_DEV_TOKEN |

### 🗂 Architecture diagram

```
                     CLIENT BROWSER
                ┌──────────────┴──────────────┐
                │                             │
         http://localhost:3000        http://localhost:3001
         (operator local web)         (VPS Next.js dashboard)
                │                             │
                ▼                             ▼
      ┌──────────────────┐          ┌──────────────────────┐
      │ server.js        │          │ Next.js 14           │
      │ Express + WS     │          │ NextAuth (Credentials)│
      │ ─ /inspection    │          │ Prisma → PostgreSQL   │
      │ ─ /api/auth/*    │          │ ─ /dashboard          │
      │ ─ /api/pending/* │          │ ─ /admin (manager)    │
      │ ─ WS /ws         │          │ ─ /admin/audit (mgr)  │
      └────┬─────────────┘          │ ─ /operator (op)      │
           │                        │ ─ /api/users CRUD     │
           │ JWT_SECRET shared      │ ─ /api/export         │
           │      ↕                 │ ─ /api/audit          │
           │ NEXTAUTH_SECRET        │ ─ /api/auth/issue-     │
           │                        │      edge-token        │
           ▼                        └────────┬───────────────┘
   ┌──────────────────┐                      │
   │ edge_camera.py   │                      │
   │ (UNTOUCHED CORE) │                      │
   │ + stream/ hook   │◄─── operator         │
   └────┬─────────────┘     redirect with    │
        │ stream :8765/:8766  JWT 15min       │
        ▼                                     │
   ┌──────────┐  ┌─────────────────┐          │
   │   JSON   │◄─┤  PostgreSQL     │◄─────────┘
   │ (mirror) │  │ inspections +   │
   └──────────┘  │ users + audit_  │
                 │ logs + sessions │
                 └─────────────────┘
```

---

## [2.3.0] — 2026-05-04

### 🎯 Tema rilis: Web UX Overhaul (Pagination / Sort / Filter / Klasifikasi per Objek) + Canonical Status Label Migration `OK→GOOD`, `NG→NOT GOOD`

Versi ini menyatukan **dua arah perubahan**:

1. **UX dashboard yang naik kelas** — dari "tabel polos auto-refresh" menjadi
   pengalaman analitik interaktif: per-tabel pagination, jump-to-page input,
   sortable headers (asc/desc), filter status, search dengan debounce, plus
   **section baru "Klasifikasi per Objek"** untuk agregasi GOOD/NOT GOOD per
   nama objek.
2. **Label status kanonikal end-to-end** — sebelumnya storage menyimpan `OK`/
   `NG` (legacy KPI internal), sementara display sudah `GOOD`/`NOT GOOD`.
   Sekarang **PostgreSQL + JSON + server.js + script.js** semuanya pakai
   label kanonikal `GOOD`/`NOT GOOD`. Edge `edge_camera.py` **tetap kirim
   `OK`/`NG` apa adanya** — server boundary yang melakukan translation.

Motivasi: pengguna menemukan inkonsistensi antara "yang dilihat" (GOOD/NOT
GOOD di web) versus "yang tersimpan" (OK/NG di JSON dan PG). Sekaligus
ingin tabel riwayat & klasifikasi yang **scale** ke ratusan/ribuan baris
tanpa overload DOM (tabel dulu cuma slice 50 row pertama tanpa kontrol).

`edge_camera.py` **tidak diubah** sama sekali — kompatibel 100% dengan
v2.2.0 / v2.1.0. Pipeline kalibrasi/masking/sub-pixel tetap utuh.

### ✨ Added — Presentation Layer (5 Stat Cards + Klasifikasi Section)

- **5-card stats grid** menggantikan layout 4-card sebelumnya:
  - `Total Inspeksi`, `Total GOOD`, `Total NOT GOOD`,
    `Persentase GOOD (Total)`, `Persentase NOT GOOD (Total)`.
  - Formula sesuai usulan dosen pembimbing:
    `GOOD Rate = Total OK / Total Inspeksi × 100%` ;
    `NG Rate  = Total NG / Total Inspeksi × 100%`.
  - Grid responsif: 2 kolom (mobile) → 3 kolom (≥600px) → 5 kolom (≥900px).
  - Aksen warna konsisten: cyan untuk GOOD rate, ng-primary (merah) untuk
    NOT GOOD rate, sesuai semantic color tokens existing.
- **Section "Klasifikasi per Objek"** (baru, antara stats grid & history table):
  - Tabel agregasi 6 kolom: `Objek · Total · GOOD · NOT GOOD · % GOOD ·
    % NOT GOOD`.
  - **Toggle button "Mode: Dikelompokkan / Mode: Semua"** di kanan-atas
    section: switch antara (a) agregasi per `object_name` sorted by total
    desc, atau (b) flat per-inspeksi (1 baris per row, suffix `#id`).
  - Filter bar dengan search input ber-debounce.
  - Center-aligned untuk kolom numerik (header & value sejajar) — kolom
    Objek tetap left-aligned untuk readability nama panjang.

### ✨ Added — Pagination Component (Reusable, Riwayat + Klasifikasi)

- **10 baris per halaman** (constant `PAGE_SIZE`).
- **Sliding 5-button window**: tombol nomor halaman cukup 5 di sekitar
  halaman aktif, ellipsis `…` muncul otomatis kalau total halaman > 5.
- **5 kontrol navigasi**: `«` first, `‹` prev, [nomor halaman aktif/sekitar],
  `›` next, `»` last. Disabled state otomatis pada batas.
- **Jump-to-page input** (`<input type="number">`) di kanan kontrol —
  ketik nomor halaman + Enter (atau blur) → langsung pindah halaman.
  Validasi clamp ke `[1, totalPages]`.
- **Page info readout**: `Halaman 3 / 12` di samping kontrol.
- **Auto-clamp** kalau `state.page > totalPages` setelah filter perubahan
  (mis. user di halaman 8, lalu apply filter yang menyisakan 2 halaman →
  otomatis pindah ke halaman 2).
- **Reset ke halaman 1** otomatis saat:
  - filter search dimasukkan/diubah,
  - status filter diubah,
  - sort kolom/direction diubah.

### ✨ Added — Sortable Headers (Riwayat + Klasifikasi)

- **Click-to-sort** pada semua TH dengan `data-sort-key`. Kedua kali klik
  TH yang sama → toggle asc ↔ desc. Klik TH lain → kolom baru, default
  direction sesuai `data-sort-type`:
  - `number` / `date` → default `desc` (terbaru/terbesar di atas).
  - `string` → default `asc` (alfabetik A-Z).
- **Sort type per kolom** declarative via `data-sort-type` di markup HTML:
  - Riwayat: `id` (number), `object_name` (string), `dimension_mm`
    (number), `status` (string), `timestamp` (date).
  - Klasifikasi: `name` (string), `total/good/ng/goodPct/ngPct` (number).
- **Visual indicator** pada TH:
  - Default sortable: `↕` opacity 35%.
  - Aktif sort: `▲` (asc) atau `▼` (desc) cyan, opacity 100%.
- **Generic `sortRows(rows, key, dir, type)`** helper:
  - `number`: numeric subtract.
  - `date`: `new Date(v).getTime()` subtract.
  - `string`: `localeCompare()` lowercase — Indonesia-friendly.
  - Stable sort via `Array.prototype.sort` + `slice()` copy.

### ✨ Added — Filter & Search Layer

- **Riwayat Inspeksi**:
  - Search input nama objek dengan **debounce 250ms** (`debounce()`
    helper) — tidak banjir filter saat user mengetik cepat.
  - Status filter dropdown: `Semua Status / GOOD / NOT GOOD` (canonical
    values selaras storage baru).
  - Counter live `N baris` di kanan filter bar — menunjukkan jumlah
    setelah filter, terpisah dari `record-count` yang menunjukkan total
    semua data.
- **Klasifikasi per Objek**:
  - Search input nama objek dengan debounce 250ms.
  - Counter live `N baris`.
  - Pencarian bekerja di kedua mode (grouped pakai field `name`,
    flat pakai field `_searchName` tanpa suffix `#id`).
- Filter bar styling konsisten dengan tema dashboard: `--bg-card-hover`
  background, focus ring cyan dengan `box-shadow 0 0 0 2px`.

### ✨ Added — State Cache & Render Pipeline

- **`latestData` cache** di top-level state — menyimpan response terakhir
  dari `/inspection`. Filter/sort/pagination re-render **tanpa fetch
  ulang** ke server — instant feedback.
- **`historyState` & `groupedState`** objects mengelola
  `{ page, sortKey, sortDir, search, statusFilter }` per-tabel
  independen. Tidak saling interferensi.
- Pipeline render baru: `data → filter → sort → paginate → DOM`. Setiap
  perubahan state via UI memanggil rerender langsung.

### 🔄 Changed — Status Label Canonical Migration `OK→GOOD`, `NG→NOT GOOD`

**Penting**: ini perubahan storage layer. Konsumer database eksternal
(BI tool, custom psql query) **perlu update** predicate dari `WHERE
status='OK'/'NG'` menjadi `WHERE status='GOOD'/'NOT GOOD'`.

- **PostgreSQL migration** (run on existing DB at v2.2.0):
  - `DROP CONSTRAINT inspections_status_check`,
  - `UPDATE inspections SET status = CASE WHEN 'OK' THEN 'GOOD' WHEN 'NG'
    THEN 'NOT GOOD' END` — 28 row migrated.
  - `ADD CONSTRAINT ... CHECK (status IN ('GOOD', 'NOT GOOD'))`.
  - **Views recreated** (CREATE OR REPLACE tidak bisa rename column):
    `v_inspection_summary` & `v_inspection_daily_trend` —
    `ok_count` → `good_count`, `ng_count` → `not_good_count`.
- **JSON migration**: `data/inspections.json` 28 row dimigrasi in-place
  pakai `node -e` script (atomic write `JSON.stringify(..., null, 2)`).
- **`db/schema.sql`** updated:
  - CHECK constraint baru `IN ('GOOD', 'NOT GOOD')`.
  - View definitions pakai `DROP VIEW IF EXISTS` + `CREATE VIEW`
    (idempotent saat re-apply ke DB lain).
  - Column comment status update ke "GOOD atau NOT GOOD".
- **`server.js` translation layer** di POST `/inspection`:
  - **`STATUS_MAP = { OK: 'GOOD', NG: 'NOT GOOD', GOOD: 'GOOD', 'NOT
    GOOD': 'NOT GOOD' }`** — idempotent.
  - Edge `edge_camera.py` POST `status: 'OK'/'NG'` tetap diterima → di-
    translate ke kanonikal sebelum INSERT. Web client POST
    `'GOOD'/'NOT GOOD'` juga diterima.
  - Validation message update: `"status harus 'GOOD' atau 'NOT GOOD'
    (legacy 'OK'/'NG' juga diterima)"`.
- **`normalizeStatus()` defense-in-depth helper** di `mirrorToPg`:
  - Bila JSON di-edit manual oleh user dengan label legacy `'OK'/'NG'`,
    `mirrorToPg` translate sebelum INSERT supaya CHECK constraint tidak
    reject.
- **`script.js`** internal status comparisons:
  - `status === 'OK'` → `status === 'GOOD'`.
  - `status === 'NG'` → `status === 'NOT GOOD'`.
  - Simulate POST body update ke `'GOOD'/'NOT GOOD'`.
  - Sort comparator `status` dihapus special-case karena sekarang
    string compare langsung sudah konsisten dengan display.
- **`index.html`** filter dropdown `<option value>` update ke canonical.
- **Display label** di seluruh UI sudah `GOOD`/`NOT GOOD`:
  - Stat card label, badge latest result, chart axis, history pill,
    klasifikasi table cells, toast notification, meta description,
    aria-labels.

### 🔄 Changed — Removed `MAX_TABLE_ROWS = 50` Constant

- Konstanta lama `MAX_TABLE_ROWS = 50` di `script.js` di-deprecated dan
  dihapus — pagination 10/halaman menggantikan slice manual.
- Konsekuensi: tabel tidak lagi cap di 50 baris terbaru. Semua row dapat
  dijelajahi via pagination kontrol.

### 🛠 Fixed — Center Alignment di Tabel Klasifikasi

- Sebelumnya: TH `text-align: left` + TD `text-align: right` → header
  dan nilai tidak sejajar visually di kolom numerik.
- Sekarang: kolom Objek (kolom 1) left-aligned, kolom numerik
  (kolom 2-6) **center-aligned untuk header & value** → angka tepat di
  bawah label header. Arrow sort `▲▼` di-padding-right 22px supaya
  tidak nempel ke teks center.

### 🔒 Untouched (zero touch sesuai konstrain capstone)

`edge_camera.py` **tidak diubah** sama sekali — 0 baris. POST status
`'OK'/'NG'` tetap valid via translation layer di server boundary.

Komponen pipeline kalibrasi yang tetap utuh dari v2.0.0 → v2.3.0:
`Config.PIXELS_PER_MM_L/W`, `save_calibration` / `load_calibration`,
`calibration_wizard` + `_wizard_phase_ktp`, `_refine_rect_corners` +
`cv2.cornerSubPix`, `_rembg_mask`, `_dominant_color_mask`,
MORPH_CLOSE 21×21 sealing pipeline.

### ⚠️ Migration Notes — Untuk Konsumer DB Direct

Konsumer database yang **bypass server.js** (psql query manual, BI tool,
custom analytics) **perlu update query**:

| Sebelum (v2.2.0) | Sesudah (v2.3.0) |
| --- | --- |
| `WHERE status = 'OK'` | `WHERE status = 'GOOD'` |
| `WHERE status = 'NG'` | `WHERE status = 'NOT GOOD'` |
| `SELECT ok_count, ng_count FROM v_inspection_summary` | `SELECT good_count, not_good_count FROM v_inspection_summary` |

API publik (POST `/inspection`) tetap kompatibel — legacy `'OK'/'NG'`
diterima oleh server lewat `STATUS_MAP`. Tapi **disarankan** client
baru langsung pakai canonical `'GOOD'/'NOT GOOD'`.

### ✅ Verified

- **Smoke test 4 POST** kombinasi (legacy OK, legacy NG, canonical GOOD,
  canonical NOT GOOD) → semua tersimpan canonical di PG dan JSON.
- **CDC sync PG↔JSON** tetap jalan paska migration (test insert/delete
  via REST → trigger NOTIFY → JSON sync ✓).
- `node --check server.js` & `node --check script.js` pass.
- Pre-migration & post-migration row count konsisten: 28 row total
  (7 GOOD + 21 NOT GOOD), tidak ada data loss.

### 📦 Files modified

| File | Lines added | Lines removed | Nature |
| --- | --- | --- | --- |
| `script.js` | +401 | -56 | Pagination/sort/filter helpers, latestData cache, klasifikasi render, debounce, status comparisons canonical |
| `style.css` | +185 | -8 | Filter bar, sortable TH, pagination bar, klasifikasi table center, ng-rate accent |
| `index.html` | +85 | -16 | 5-card stats grid, klasifikasi section, filter bar markup, sortable th attributes, pagination containers, dropdown values canonical |
| `db/schema.sql` | +27 | -20 | CHECK constraint canonical, DROP+CREATE views (good_count/not_good_count) |
| `server.js` | +20 | -5 | STATUS_MAP translation, normalizeStatus() helper, validation message update |
| `package.json` | +1 | -1 | version 2.2.0 → 2.3.0 |
| `data/inspections.json` (gitignored) | runtime | runtime | 28 rows migrated OK→GOOD, NG→NOT GOOD |
| `edge_camera.py` | **0** | **0** | **untouched** |

### 🗂 Translation Flow Diagram

```
   edge_camera.py POST status='OK'/'NG' (legacy, unchanged)
                            │
                            ▼
   ┌────────────────────────────────────────────────┐
   │ server.js POST /inspection                     │
   │   STATUS_MAP = { OK→GOOD, NG→NOT GOOD,         │
   │                  GOOD→GOOD, NOT GOOD→NOT GOOD }│
   └──────────────┬─────────────────────────────────┘
                  │ canonical 'GOOD'/'NOT GOOD'
                  ▼
   ┌──────────────────────────────────────────────┐
   │ PostgreSQL inspections                       │
   │   CHECK (status IN ('GOOD','NOT GOOD'))      │
   └──────┬───────────────────────────────┬───────┘
          │ NOTIFY                        │ SELECT
          ▼                               ▼
   data/inspections.json              Web Dashboard
   (canonical 'GOOD'/'NOT GOOD')      (display 'GOOD'/'NOT GOOD')
```

---

## [2.2.0] — 2026-05-03

### 🎯 Tema rilis: Hybrid Storage + Bidirectional CDC Sync

Versi ini mengubah arsitektur storage dari **single-source JSON flat-file**
menjadi **dual-store dengan PostgreSQL sebagai canonical + JSON sebagai
mirror**, dihubungkan oleh **Change Data Capture (CDC) bidirectional** dan
**WebSocket realtime broadcast**. Edge `edge_camera.py` **tidak diubah**
sama sekali — kompatibel 100% dengan v2.1.0.

Motivasi: pengguna ingin (a) data inspeksi bisa di-query SQL untuk
analitik / integrasi BI / aplikasi lain, (b) JSON tetap dipertahankan
sebagai backup offline-friendly NoSQL-style, (c) realtime push ke
dashboard tanpa polling, (d) konsistensi antara dua store seperti
foreign-key — perubahan di salah satu mengikuti otomatis ke yang lain.

### ✨ Added — PostgreSQL Schema & Triggers

- **`db/schema.sql`** — DDL idempotent untuk tabel `inspections` dengan:
  - Kolom: `id (PK)`, `object_name`, `dimension_mm`, `width_mm`,
    `confidence`, `status`, `timestamp`
  - 4 CHECK constraint: `status IN ('OK','NG')`, `dimension_mm > 0`,
    `width_mm > 0 OR NULL`, `confidence ∈ [0,1] OR NULL`
  - 5 index: PK + `idx_inspections_ts_desc`, `idx_inspections_object_name`,
    `idx_inspections_status`, `idx_inspections_obj_status`
  - 3 view analitik: `v_inspection_summary`, `v_inspection_daily_trend`,
    `v_inspection_recent`
  - ID sengaja `INTEGER` (bukan `SERIAL`) — disuplai dari server.js
    supaya konsisten 1:1 dengan JSON file
- **`db/triggers.sql`** — fungsi PL/pgSQL `notify_inspection_change()`
  + trigger AFTER INSERT/UPDATE/DELETE/TRUNCATE yang fire `pg_notify`
  ke channel `inspection_change`. Payload JSON `{op, id, data}` dipakai
  server.js LISTEN client untuk replikasi ke JSON.
- **`db/seed_sample.sql`** — 15 row contoh untuk smoke test schema +
  view analitik.
- **`db/dml_examples.sql`** — referensi DML komprehensif (INSERT/UPDATE/
  DELETE/SELECT, window function, outlier detection via z-score).

### ✨ Added — Server CDC Pipeline (`server.js` major refactor)

- **PG Pool init** dengan graceful fallback: bila `.env` salah / PG mati
  → `pgReady=false`, server tetap jalan JSON-only mode (zero downtime).
- **PG LISTEN client** (dedicated `Client`, bukan dari pool) yang
  subscribe ke channel `inspection_change`. Setiap NOTIFY → parse
  payload → replikasi ke JSON via `applyPgChangeToJson()` dengan event
  type INSERT/UPDATE/DELETE/TRUNCATE.
- **File watcher** via `chokidar` dengan `awaitWriteFinish` (250ms
  stability threshold) memantau `data/inspections.json`. Setiap edit
  manual → debounce 200ms → `reconcileJsonToPg()` diff JSON ↔ PG dan
  push perubahan (INSERT row baru / DELETE row yang hilang).
- **Internal write lock** (`writeDataInternal()`) mencegah feedback
  loop: tulisan dari server sendiri (akibat NOTIFY listener) di-skip
  oleh watcher selama 600ms.
- **Auto-migrate JSON → PG** saat startup bila tabel PG kosong tapi
  JSON sudah berisi (migrasi awal otomatis).
- **Catch-up sync on PG reconnect** (`tryReconnectListener()` retry
  setiap 5s + `catchUpPendingJsonToPg()`) — saat PG offline → online,
  row JSON yang belum di PG di-push otomatis.
- **WebSocket server** di `ws://localhost:3000/ws` (path-based upgrade
  pada HTTP server yang sama, no port baru). Setiap state change
  broadcast event `inspection.created/updated/deleted/cleared` +
  `pending.created/named/cancelled`.
- **Empty-file wipe semantic**: edit JSON → file 0 bytes / whitespace
  saja → reconcile interpret sebagai intentional wipe-all → TRUNCATE
  PG + auto-restore JSON ke `[]`. Auto-increment otomatis reset ke 1.
- **Strict parse safety**: file JSON corrupt (sintaks salah) tidak
  pernah men-trigger wipe PG → PG dipertahankan, log warning.
- **REST endpoints baru** (`/api/v1/*`): `status`, `inspection`,
  `stats/by-object`, `stats/trend`, `stats/recent` — semuanya PG-backed
  dengan fallback JSON saat PG offline.
- **PG-first POST** `/inspection`: `INSERT ... VALUES (MAX(id)+1, ...)`
  + `RETURNING *`, JSON sync via NOTIFY trigger (bukan dual-write).
  ID konsisten karena PG-side increment.
- **Surgical DELETE** `/inspection/:id` baru — hapus single row,
  trigger fire NOTIFY → JSON ikut sync.

### ✨ Added — Dashboard Realtime (`script.js`, `index.html`, `style.css`)

- **WebSocket client** dengan exponential backoff reconnect (1s → 30s).
  Listen event `inspection.*` + `pending.*` → trigger `fetchAndRender()`
  / `fetchPending()` instan.
- **WS status indicator** (`⚡` di header, hijau pulsing saat online,
  abu saat offline) dengan tooltip status koneksi.
- **GET `/inspection`** sekarang PG-backed via REST → dashboard lihat
  langsung perubahan dari psql / external service / direct DML.
- **Polling REFRESH_MS** (5s) tetap jadi safety net jika WebSocket
  terputus, tapi bukan jalur utama.

### ✨ Added — Quality Assurance Harness (`qa/`)

- **`qa/test_suite.js`** — 29 TC end-to-end integration test
  (connectivity, schema integrity, REST write path, WS broadcast,
  PG DML, analytics endpoints, pending naming, cleanup).
- **`qa/test_cdc.js`** — 23 TC khusus bidirectional CDC sync
  (PG → JSON via NOTIFY, JSON → PG via watcher, REST consistency,
  safety guard).
- **`qa/inject_dml.js`** — simulator injeksi 15 row variatif (KTP,
  Botol Kecap, Tutup Panci, Spidol, Pulpen, dll.) dengan jeda 5 detik
  per row. Mode `usePostMode` toggle antara REST POST atau DML direct.
- **`qa/REPORT.md` & `qa/REPORT_CDC.md`** — auto-generated SQA report
  dengan metadata lengkap (tester, project, environment, git commit,
  category breakdown, detailed TC results, sign-off section).

### 📦 Added — Dependencies (npm)

| Library | Reason | Why this choice |
| --- | --- | --- |
| `pg ^8.x` | PostgreSQL driver Node.js | Industry standard, mendukung pool + dedicated Client untuk LISTEN long-lived connection. Pure JS, no native build. |
| `ws ^8.x` | Raw WebSocket protocol | Lightweight, native browser API kompatibel (no client library needed). Path-based upgrade pada Express HTTP server. Lebih ringan dari socket.io untuk capstone scale. |
| `dotenv ^17.x` | Environment variable loader | Standard pattern; kredensial PG dipindahkan dari hardcode ke `.env` (gitignored), `.env.example` di-commit sebagai template. |
| `chokidar ^5.x` | File watcher dengan stability detection | `fs.watch` built-in fire multiple kali per save (atomic rename pattern editor). chokidar punya `awaitWriteFinish` untuk debounce + cross-platform reliability. Esensial untuk JSON → PG sync tanpa false trigger. |

### 🛠 Fixed

- **Auto-increment reset to 1** saat tabel kosong — implicit via
  `(SELECT COALESCE(MAX(id), 0) + 1 FROM inspections)` di POST handler.
  Konsisten di semua method delete: REST `DELETE /inspection`, psql
  `TRUNCATE`, `DELETE FROM`, edit JSON ke `[]` / 0 bytes / whitespace.
- **Graceful shutdown <50ms** (sebelumnya stuck di `httpServer.close()`
  saat ada WebSocket client / HTTP keep-alive aktif). Sekarang
  `client.terminate()` semua WS + `httpServer.closeAllConnections()` +
  hard timeout 1.5s sebagai safety net. Ctrl-C kedua force exit
  langsung. SIGTERM juga di-handle.

### 🔒 Untouched (bumbu rahasia kalibrasi v2.0/v2.1 tetap utuh)

`edge_camera.py` **tidak diubah** sama sekali. POST ke `/inspection`
endpoint yang sama. Pipeline calibration KTP, masking, sub-pixel
refinement, anisotropic ppmm — semua identik dengan v2.1.0.

### 🗂 Architecture diagram

```
                      ┌──────────────────┐
                      │   Dashboard UI   │
                      │   (script.js)    │
                      └─────┬────────▲───┘
                  REST GET  │        │ WS realtime push
                            ▼        │
                      ┌─────────────┴────┐
                      │   server.js      │  ← chokidar watch JSON
   edge_camera.py ────►   (CDC orchestra)│
   (UNCHANGED)        │                  │  ← pg LISTEN/NOTIFY
                      └──┬───────┬───────┘
                         ▼       ▼
                  ┌──────────┐  ┌─────────────────┐
                  │   JSON   │◄─┤  PostgreSQL     │
                  │ (NoSQL   │  │ + triggers      │
                  │  archive)│  │ + analytics     │
                  └─────▲────┘  └────────▲────────┘
                        │                │
                user/admin           psql / BI tool /
                edit manual          mobile app / ETL
```

### 📦 Files added/modified

| File | Change | Nature |
| --- | --- | --- |
| `db/schema.sql` | new | DDL: table, indexes, views (170 LOC) |
| `db/triggers.sql` | new | DDL: pg_notify trigger functions |
| `db/seed_sample.sql` | new | DML: 15 sample rows |
| `db/dml_examples.sql` | new | DML reference (INSERT/UPDATE/DELETE/SELECT) |
| `qa/test_suite.js` | new | 29-TC SQA suite + REPORT.md generator |
| `qa/test_cdc.js` | new | 23-TC CDC sync suite + REPORT_CDC.md generator |
| `qa/inject_dml.js` | new | 15-row injection demo with 5s pacing |
| `qa/REPORT.md` | new | Auto-generated SQA report |
| `qa/REPORT_CDC.md` | new | Auto-generated CDC sync report |
| `.env.example` | new | Template kredensial PG (committed) |
| `.env` | new (gitignored) | Local PG credentials |
| `server.js` | major refactor | +600 LOC: PG, WS, CDC, watcher |
| `script.js` | feature add | +95 LOC: WS client + reconnect + indicator |
| `index.html` | feature add | +1 line: WS indicator span |
| `style.css` | feature add | +30 LOC: ws-online/offline animation |
| `package.json` | dep add | +4 packages, version 2.1.0 → 2.2.0 |
| `package-lock.json` | dep sync | npm install lockfile |
| `.gitignore` | rule add | exclude `.env`, `.env.local` |
| `edge_camera.py` | **untouched** | 0 lines changed |

---

## [2.1.0] — 2026-04-28

### ✨ Added

#### Hybrid object naming (terminal **atau** web dashboard)

Saat objek baru terdeteksi, user bisa pilih sumber input nama — terminal **atau**
web — mana duluan menang.

- **REST endpoints baru** di `server.js`:
  - `POST   /api/pending`           — edge mendaftarkan objek tak dikenal, return `{id}`
  - `GET    /api/pending`           — web ambil daftar pending yang belum dinamai
  - `GET    /api/pending/:id`       — edge polling status pending (cek nama)
  - `POST   /api/pending/:id/name`  — web submit nama
  - `DELETE /api/pending/:id`       — skip/cancel pending
  - In-memory store dengan TTL 2 menit + retention 30 detik post-naming
    untuk memastikan poller edge sempat menerima nama
- **Section "Objek Baru — Beri Nama"** di dashboard (`index.html` + `style.css`):
  - Muncul otomatis saat ada pending, hidden saat tidak ada
  - Pulse-border animation amber agar eye-catching
  - Auto-focus input baru, Enter-to-save, tombol Skip inline
- **`prompt_object_name` hybrid** di `edge_camera.py`:
  - POST pending → daemon thread polling web → input terminal paralel
  - **POSIX TTY non-blocking** via `select.select([sys.stdin], [], [], 0.15)`:
    saat web submit duluan, edge lanjut **instan** tanpa user perlu tekan
    Enter di terminal
  - `termios.tcflush(stdin, TCIFLUSH)` membuang partial typing pre-Enter
    setelah web menang → ketikan stale tidak nyangkut ke prompt berikutnya
  - Windows / non-TTY fallback: blocking `input()` dengan notice "TEKAN ENTER"
  - Server mati / unreachable → POST gagal → fallback **otomatis** ke
    terminal-only (100% kompatibel dengan v2.0.0)

### 🛠 Fixed — Masking robustness pada objek besar / kilap

Tiga perbaikan **additive** di `extract_measurement` yang **tidak** menyentuh
bumbu kalibrasi (`PIXELS_PER_MM_L/W`, `cornerSubPix`, wizard ppmm tetap utuh):

- **Size-gated `_contour_touches_edge`** — sebelumnya filter tepi (margin 8px)
  menolak SEMUA kontur yang menyentuh tepi, termasuk objek besar (tutup
  panci, piring) yang secara legitimate mengisi seluruh frame. Akibatnya
  fragmen tengah jadi pemenang dan bbox menjadi sliver memanjang aneh
  (contoh: 72×17mm pada disk lingkaran). Sekarang filter hanya menolak jika
  bbox **<15% area frame** — lengan/jari kecil dari tepi tetap dibuang,
  objek besar legit diloloskan.
- **RETR_EXTERNAL fill** setelah `MORPH_CLOSE 21×21` — `findContours(RETR_EXTERNAL)`
  + `drawContours(FILLED)` menutup hole internal yang ditinggalkan rembg
  pada area highlight kilap (dome plastik mengkilap). Idempotent untuk KTP
  yang masknya sudah solid → boundary identik bit-for-bit, akurasi
  kalibrasi tidak berubah.
- **Edge-connected `_detect_skin_mask`** — skin filter sebelumnya membuang
  semua piksel YCrCb dalam range Phung [Cr 133-173, Cb 77-127], termasuk
  highlight oranye/kuning/coklat di plastik skin-tone yang **kebetulan**
  jatuh dalam range tsb. Akibatnya hampir setengah disk oranye hilang dari
  mask. Sekarang hanya komponen skin yang **menyentuh tepi frame** yang
  dianggap jari/lengan dari luar; patch skin di interior objek (highlight
  plastik, wajah pada KTP) dipertahankan.

### 🛠 Fixed — Web naming UX

- **DOM diff render** di `script.js renderPending`: sebelumnya `list.innerHTML = ...`
  setiap 1.5s polling membongkar DOM dan membuatnya ulang → cursor reset ke
  awal + karakter yang ditekan tepat saat re-render bisa hilang. Sekarang
  hanya `appendChild` kartu baru / `remove()` kartu yang sudah hilang.
  Kartu existing tidak pernah disentuh.
- **Typing-aware guard**: jika `document.activeElement` adalah pending input
  yang masih ada di server response → render di-skip total (nol operasi DOM).
  Memastikan tidak ada interferensi sama sekali saat user mengetik nama panjang.

### 🔒 Untouched (bumbu rahasia kalibrasi)

Komponen berikut **tidak diubah** dari v2.0.0 — accuracy KTP 85.6×53.98mm
tetap presisi sub-millimeter:

- `Config.PIXELS_PER_MM_L`, `Config.PIXELS_PER_MM_W` (anisotropic ppmm)
- `save_calibration` / `load_calibration`
- `calibration_wizard` + `_wizard_phase_ktp` (4-stage lock)
- `_refine_rect_corners` + `cv2.cornerSubPix` (sub-pixel refinement)
- `_rembg_mask`, `_dominant_color_mask` (masking primary)
- MORPH_CLOSE 21×21 iter=2 + erode 3×3 iter=1 (sealing pipeline)
- Endpoint `/inspection` (POST/GET/DELETE) dan logic dashboard inti
  (latest card, stats, chart, history)

### 📦 Files modified

| File             | Lines added | Lines removed | Nature |
| ---------------- | ----------- | ------------- | ------ |
| `edge_camera.py` | +254        | -16           | Hybrid naming, masking robustness fixes |
| `server.js`      | +85         | -1            | Pending endpoints |
| `script.js`      | +145        | -0            | Pending polling, DOM diff, typing guard |
| `index.html`     | +11         | -0            | Pending section markup |
| `style.css`      | +134        | -0            | Pending card styles |

---

## [2.0.0] — 2026 (commit `9d0fc74`)

### ✨ Added — Initial release

- Sub-pixel 4-corner refinement via `cv2.cornerSubPix` on gradient image
- Anisotropic ppmm (separate scale untuk axis L dan W)
- Cross-calibration via measurement pipeline (50-frame median + 1.5σ outlier reject)
- 4-stage wizard lock: detection + containment + center (≤4%) + rotation (≤2°)
- Real-time rotation guidance ("Putar kiri/kanan" dengan derajat)
- Sidebar info panel dengan procedure + real-time status
- rembg ML segmentation + YCrCb skin filter + edge-touch reject
- Aggressive morphological sealing (21×21) untuk pola kartu kompleks
- Convex hull stabilization terhadap occlusion jari
- Backend menerima `object_name`, `width_mm`, `confidence` dalam payload
- Dashboard render nama objek di latest card + history table
- HTML escape untuk nama objek user-supplied
- `requirements.txt` untuk reproducible Python environment
- README.md komprehensif: panduan instalasi pemula, semantic flow, detail
  algoritma, parameter table, troubleshooting
- `.gitignore` mengabaikan file runtime/user-specific

---

**Hak Cipta:** Capstone Topik A3 Kelompok 2,
Fakultas Ilmu Komputer, Universitas Brawijaya.
