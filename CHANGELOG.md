# Changelog

Semua perubahan penting pada project ini didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
dan project ini mengikuti [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
