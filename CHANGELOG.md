# Changelog

Semua perubahan penting pada project ini didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
dan project ini mengikuti [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
