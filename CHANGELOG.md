# Changelog

Semua perubahan penting pada project ini didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
dan project ini mengikuti [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
