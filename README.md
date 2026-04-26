<div align="center">

# 🔬 Automated Dimensional Inspection System

### Sistem Inspeksi Dimensi Otomatis berbasis Computer Vision dengan Kalibrasi KTP-Referensi

> **Capstone Project · Topik A3 · Kelompok 2**
> **Fakultas Ilmu Komputer · Universitas Brawijaya**

---

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python&logoColor=white)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![OpenCV](https://img.shields.io/badge/OpenCV-4.8%2B-5C3EE8?logo=opencv&logoColor=white)](https://opencv.org/)
[![rembg](https://img.shields.io/badge/rembg-U2--Net-orange)](https://github.com/danielgatis/rembg)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Production--Ready-brightgreen)]()
[![Accuracy](https://img.shields.io/badge/Accuracy-Sub--millimeter-success)]()

</div>

---

## ⚖️ Disclaimer & Hak Cipta

> ```
> ╔═══════════════════════════════════════════════════════════════════╗
> ║                                                                   ║
> ║   © 2026 — CAPSTONE TOPIK A3 KELOMPOK 2                           ║
> ║   FAKULTAS ILMU KOMPUTER · UNIVERSITAS BRAWIJAYA                  ║
> ║                                                                   ║
> ║   Semua kode, dokumentasi, algoritma kalibrasi, dan UX wizard     ║
> ║   dalam repository ini merupakan hasil karya intelektual          ║
> ║   Capstone Topik A3 Kelompok 2 Filkom UB.                         ║
> ║                                                                   ║
> ║   • Penggunaan komersial WAJIB mencantumkan atribusi              ║
> ║   • Penggunaan akademik bebas dengan referensi yang sesuai        ║
> ║   • Plagiat = pelanggaran etika akademik                          ║
> ║                                                                   ║
> ╚═══════════════════════════════════════════════════════════════════╝
> ```

---

## 📑 Daftar Isi

<table>
<tr><td>

**📚 Pengantar**
- [Tentang Proyek](#-tentang-proyek)
- [Arsitektur Sistem](#-arsitektur-sistem)
- [Fitur Utama](#-fitur-utama)
- [Tech Stack](#-tech-stack)

</td><td>

**🚀 Mulai**
- [Persyaratan Sistem](#-persyaratan-sistem)
- [Instalasi (Pemula)](#-instalasi-untuk-pemula-sama-sekali)
- [Cara Menjalankan](#-cara-menjalankan)
- [Alur Program](#-alur-program-penjelasan-semantik)

</td><td>

**🔬 Teknis**
- [Skenario Penggunaan](#-skenario-penggunaan-umum)
- [Detail Teknis Algoritma](#-detail-teknis-algoritma)
- [Konfigurasi & Tuning](#-konfigurasi--tuning)
- [API Reference](#-api-reference)

</td><td>

**📋 Lainnya**
- [Struktur Project](#-struktur-project)
- [Troubleshooting](#-troubleshooting)
- [Roadmap](#-roadmap)
- [Tim & Lisensi](#-tim-pengembang)

</td></tr>
</table>

---

## 📖 Tentang Proyek

**Automated Dimensional Inspection System** adalah sistem komputasi visual end-to-end yang mengukur dimensi fisik (panjang × lebar) suatu objek 2D secara otomatis menggunakan kamera HP/webcam, dengan **KTP Indonesia (85.6 × 53.98 mm)** sebagai referensi kalibrasi.

### 💡 Mengapa Sistem Ini Ada?

<table>
<tr>
<th width="50%">❌ Masalah Tradisional</th>
<th width="50%">✅ Solusi Sistem Ini</th>
</tr>
<tr>
<td>

- Operator perlu jangka sorong / mistar untuk tiap objek
- Pengukuran manual rentan error & subjektif
- Alat ukur industri (Keyence, Mitutoyo) Rp 50jt+
- Butuh ArUco marker / calibration grid khusus
- Setup kompleks, tidak bisa dipakai operator awam

</td>
<td>

- Otomatis via kamera (HP/webcam standar)
- Akurasi sub-millimeter konsisten
- Hardware <Rp 1jt total
- Pakai KTP yang setiap orang punya
- Operator awam bisa pakai dalam 5 menit

</td>
</tr>
</table>

### 🆔 Mengapa KTP?

KTP Indonesia mengikuti standar **ISO/IEC 7810 ID-1** (sama dengan kartu kredit, ATM, SIM, NPWP). Ukurannya **terdefinisi internasional**:

| Format         | Panjang     | Lebar       |
|---------------:|:-----------:|:-----------:|
| **Centimeter** | 8.56 cm     | 5.398 cm    |
| **Milimeter**  | **85.6 mm** | **53.98 mm**|
| **Inci**       | 3.37 in     | 2.12 in     |
| **Aspek**      | 1.5854      | —           |

> 💡 **Setiap warga Indonesia memiliki KTP**, jadi tidak perlu beli alat kalibrasi. Cukup taruh KTP di depan kamera satu kali, dan sistem siap mengukur objek apa pun dengan akurasi sub-millimeter.

### 🎯 Apa yang Bisa Diukur?

<table>
<tr>
<th width="50%">✅ Cocok</th>
<th width="50%">❌ Tidak Cocok</th>
</tr>
<tr valign="top">
<td>

- Komponen elektronik (PCB, modul, casing tipis)
- Produk packaging (kotak datar, kantong, label)
- Kartu identitas, voucher, ID badge
- Sparepart kecil (gear, plate, mur, baut < 5mm tinggi)
- Sample produk (kemasan makanan datar)

</td>
<td>

- Objek 3D dengan tinggi signifikan (> 1 cm)
- Objek transparan / refleksi tinggi
- Objek dengan warna sangat mirip latar
- Objek lebih besar dari frame kamera

</td>
</tr>
</table>

---

## 🏗️ Arsitektur Sistem

Sistem 3-tier yang berjalan paralel:

```
┌──────────────────────────────────────────────────────────────────────┐
│                  LAYER 1: EDGE DEVICE  (Python)                      │
│                                                                      │
│   Camera capture                                                     │
│       ↓                                                              │
│   rembg ML segmentation  (U2-Net via ONNX)                           │
│       ↓                                                              │
│   YCrCb skin filter  (buang jari/tangan)                             │
│       ↓                                                              │
│   MORPH_CLOSE 21×21  (seal pattern interior)                         │
│       ↓                                                              │
│   Center-weighted contour scoring                                    │
│       ↓                                                              │
│   approxPolyDP → cornerSubPix  (sub-pixel 4 sudut)                   │
│       ↓                                                              │
│   L_px, W_px → ÷ ppmm_L, ppmm_W → L_mm, W_mm                         │
│       ↓                                                              │
│   Median smoother (15 frames)                                        │
│       ↓                                                              │
│   POST /inspection ──────────────────────────────────────┐           │
└──────────────────────────────────────────────────────────┼───────────┘
                                                          │ HTTP/JSON
┌──────────────────────────────────────────────────────────▼───────────┐
│                  LAYER 2: BACKEND API  (Node.js + Express)           │
│                                                                      │
│   POST   /inspection  →  validate  →  data/inspections.json          │
│   GET    /inspection  →  sort id desc  →  return JSON                │
│   DELETE /inspection  →  wipe storage                                │
└──────────────────────────────────────────────────────────┬───────────┘
                                                          │ HTTP/JSON
┌──────────────────────────────────────────────────────────▼───────────┐
│                  LAYER 3: DASHBOARD  (HTML + JS + Chart.js)          │
│                                                                      │
│   Auto-refresh 5s  →  latest card  →  stats  →  bar chart            │
│   History table:  ID │ Objek │ Dimensi │ Status │ Waktu              │
└──────────────────────────────────────────────────────────────────────┘
```

### 🎨 Mengapa Pipeline 3-Tier?

| Layer | Tanggung Jawab | Mengapa Terpisah? |
|-------|----------------|-------------------|
| **Edge** | Image processing lokal | Tidak perlu kirim video stream → hemat bandwidth, privacy-friendly |
| **Backend** | Stateless storage | Cocok multi-user / horizontal scaling |
| **Dashboard** | Visualisasi | Browser-based, akses dari device manapun di jaringan |

---

## ✨ Fitur Utama

### 🎯 Pengukuran Presisi

| Fitur | Spesifikasi | Detail |
|-------|-------------|--------|
| Akurasi target | ±0.05 mm bias | Setelah kalibrasi penuh |
| Resolusi pixel | <0.1 px | Via `cv2.cornerSubPix` |
| Skala | Anisotropic | Skala terpisah L vs W |
| Smoothing | Median 15 frames | Latensi 0.5s @ 30fps |

### 🤖 Segmentasi Objek

- **Neural network mask** via [rembg](https://github.com/danielgatis/rembg) U2-Net (~5MB model)
- **Hand & finger rejection** — 3 lapis pertahanan (skin filter + edge reject + center scoring)
- **Convex hull stabilization** — bbox tetap stabil saat jari menutup-buka objek
- **Hull-fill mask preview** — tekan `[V]` untuk visualisasi rapi padat

### 🧙 Wizard Kalibrasi

| Stage | Validasi | Threshold |
|-------|----------|-----------|
| 1 | KTP terdeteksi (4 sudut, solidity ≥ 0.9) | ratio 1.585 ±6% |
| 2 | Reticle DI DALAM kotak KTP | bbox containment |
| 3 | Reticle DI TENGAH KTP | offset ≤ 4% × short side |
| 4 | KTP LURUS (axis-aligned) | tilt ≤ 2.0° |

> 🔄 **Real-time rotation guidance**: pesan "Putar kanan / Putar kiri / Sedikit lagi" dengan derajat aktual diupdate tiap frame.

### 📚 Object Catalog

```json
{
  "name": "KTP",
  "L_mm": 85.6,
  "W_mm": 53.98,
  "tol_L": 2.0,
  "tol_W": 2.0,
  "created": "2026-04-27T00:00:00"
}
```

- **Multi-profile** catalog (`objects.json`)
- **Auto-match** ±8mm window
- **GOOD / NOT GOOD** evaluation per profil
- **Auto-register** stable unknown objects (prompt for name)

### 📊 Dashboard & Integration

- Live dashboard with **Chart.js** (OK/NG bar chart)
- **REST API** (POST/GET/DELETE)
- **Android WebView** ready
- **Toast notifications** untuk OK/NG events

---

## 🛠️ Tech Stack

### 🐍 Edge Device (Python)

| Library | Versi | Fungsi |
|---------|-------|--------|
| `python` | ≥ 3.10 | Runtime |
| `opencv-python` | ≥ 4.8 | CV primitives, kontur, threshold, morfologi |
| `numpy` | ≥ 1.24 | Array ops, median, statistics |
| `rembg` | ≥ 2.0 | ML background removal (U2-Net) |
| `onnxruntime` | ≥ 1.17 | Backend untuk rembg |
| `requests` | ≥ 2.31 | HTTP client → backend API |

### 🟢 Backend (Node.js)

| Library | Versi | Fungsi |
|---------|-------|--------|
| `node` | ≥ 18 | Runtime |
| `express` | ^4.18 | HTTP server, routing |
| `cors` | ^2.8 | CORS middleware |

### 🌐 Frontend

| Library | Versi | Fungsi |
|---------|-------|--------|
| HTML5 / CSS3 | — | Markup + styling (dark theme) |
| Vanilla JS | ES2020+ | Logic + fetch API |
| Chart.js | ^4.4 | Bar chart OK vs NG |

### 💾 Storage Format

| File | Type | Konten |
|------|------|--------|
| `calibration.json` | runtime | `{pixels_per_mm, pixels_per_mm_L, pixels_per_mm_W}` |
| `objects.json` | runtime | Array profil objek |
| `data/inspections.json` | runtime | History pengukuran |

---

## 💻 Persyaratan Sistem

### 🖥️ Hardware

| Komponen | Minimum | Direkomendasikan | Optimal |
|----------|---------|------------------|---------|
| **CPU** | Dual-core 2.0 GHz | Quad-core 2.5+ GHz | Apple Silicon / Ryzen 7+ |
| **RAM** | 4 GB | 8 GB | 16 GB |
| **Storage** | 500 MB free | 2 GB | 5 GB |
| **Kamera** | 720p webcam | 1080p phone (DroidCam) | 4K phone (USB-C tethered) |
| **GPU** | — | — | NVIDIA dengan CUDA (boost rembg 5×) |

### 🖱️ Operating System

- ✅ **macOS** 12.0+ (Monterey or newer) — fully tested
- ✅ **Windows** 10 / 11
- ✅ **Linux** Ubuntu 20.04+ / Debian 11+ / Fedora 35+

### 📱 Peripheral (Opsional)

- HP Android/iOS dengan app **DroidCam** atau **iVCam** untuk pakai kamera HP sebagai webcam
- **Tripod / gooseneck holder** untuk fixed mount mode
- **Lampu LED desk** untuk pencahayaan konsisten
- **Latar polos kontras** (kertas A3 putih atau hitam) untuk segmentasi optimal

### 📜 Dokumen Fisik

- **Sebuah KTP** (untuk kalibrasi awal saja — tidak disimpan, hanya scale reference)

---

## 🚀 Instalasi (Untuk Pemula Sama Sekali)

> 🐣 **Bagian ini ditulis untuk seseorang yang TIDAK PERNAH PAKAI TERMINAL**. Jika kamu sudah familiar, lompat ke [Cara Menjalankan](#-cara-menjalankan).

### 📍 Langkah 0 — Buka Terminal

Terminal adalah jendela hitam-putih untuk mengetik perintah.

| OS | Cara Buka |
|----|-----------|
| **macOS** | `Cmd + Space` → ketik `Terminal` → Enter |
| **Windows** | `Win + R` → ketik `cmd` → Enter |
| **Linux** | `Ctrl + Alt + T` |

> 💡 **Setiap baris perintah di tutorial ini, ketik di terminal, lalu tekan Enter.**

### 📍 Langkah 1 — Install Python

Python menjalankan `edge_camera.py`. Butuh versi **3.10 atau lebih baru**.

#### 🍎 macOS (via Homebrew — rekomendasi)

```bash
# Install Homebrew (sekali seumur hidup, kalau belum punya)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Python
brew install python@3.12
```

#### 🪟 Windows

1. Buka https://www.python.org/downloads/ di browser
2. Klik tombol kuning **"Download Python 3.12.x"**
3. Jalankan installer
4. ⚠️ **PENTING**: Centang ☑ **"Add python.exe to PATH"** di halaman pertama
5. Klik **"Install Now"**, tunggu sampai selesai
6. **Restart terminal**

#### 🐧 Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install python3 python3-pip python3-venv -y
```

#### ✅ Verifikasi

```bash
python3 --version
# ➜ Python 3.12.x atau lebih baru
```

### 📍 Langkah 2 — Install Node.js

Node.js menjalankan backend server. Butuh versi **18 atau lebih baru**.

| OS | Perintah |
|----|----------|
| 🍎 macOS | `brew install node` |
| 🪟 Windows | Download dari https://nodejs.org/en/download (pilih **LTS**) |
| 🐧 Linux | `curl -fsSL https://deb.nodesource.com/setup_lts.x \| sudo -E bash -` lalu `sudo apt install nodejs -y` |

#### ✅ Verifikasi

```bash
node --version    # ➜ v18.x.x atau lebih baru
npm --version     # ➜ 9.x.x atau lebih baru
```

### 📍 Langkah 3 — Install Git

Git untuk download project dari GitHub.

| OS | Perintah |
|----|----------|
| 🍎 macOS | `brew install git` (biasanya sudah ada — cek `git --version`) |
| 🪟 Windows | https://git-scm.com/download/win → install dengan opsi default |
| 🐧 Linux | `sudo apt install git -y` |

### 📍 Langkah 4 — Clone Repository

```bash
# Pindah ke folder Documents (atau folder lain pilihan kamu)
cd ~/Documents

# Download project dari GitHub
git clone https://github.com/ChrozaGaming/CAPSTONE.git

# Masuk ke folder project
cd CAPSTONE
```

### 📍 Langkah 5 — Setup Virtual Environment Python

> 💡 **Apa itu virtual environment?**
> Kotak terisolasi untuk install library Python project ini saja. Tidak akan bercampur dengan Python sistem atau project lain. Best practice profesional.

```bash
# Buat virtual env di folder .venv/
python3 -m venv .venv

# Aktifkan venv
# 🍎 macOS / 🐧 Linux:
source .venv/bin/activate

# 🪟 Windows (Command Prompt):
.venv\Scripts\activate.bat

# 🪟 Windows (PowerShell):
.venv\Scripts\Activate.ps1
```

Setelah aktif, prompt terminal akan punya `(.venv)` di depan:

```
(.venv) macbookpro@host CAPSTONE %
```

> ⚠️ **Setiap kali buka terminal baru, AKTIFKAN venv dulu** sebelum jalankan `python edge_camera.py`. Tanpa aktivasi, library tidak akan ke-detect.

### 📍 Langkah 6 — Install Library Python

```bash
pip install -r requirements.txt
```

| Detail | Nilai |
|--------|-------|
| Total download | ~500 MB |
| Estimasi waktu | 2–5 menit (broadband) |
| First rembg run | Download U2-Net model (~5MB) ke `~/.u2net/` |

### 📍 Langkah 7 — Install Dependency Node.js

```bash
npm install
```

Cepat (~10 detik). Folder `node_modules/` akan terbentuk dengan `express` + `cors`.

---

## ▶️ Cara Menjalankan

Sistem terdiri dari **DUA program** yang harus jalan **BERSAMAAN** di **DUA terminal terpisah**:

### 🖥️ Terminal 1 — Backend Server

```bash
cd ~/Documents/CAPSTONE
node server.js
```

Output yang diharapkan:
```
╔══════════════════════════════════════════════════╗
║   Automated Dimensional Inspection - Backend     ║
║   Server berjalan di http://localhost:3000       ║
╚══════════════════════════════════════════════════╝
```

> 🔓 **Biarkan terminal ini terbuka.** Server jalan terus selama terminal aktif. Jangan tutup.

### 📷 Terminal 2 — Edge Camera

Buka **terminal baru** (jangan tutup yang pertama!):

```bash
cd ~/Documents/CAPSTONE
source .venv/bin/activate           # 🍎🐧
# .venv\Scripts\activate.bat        # 🪟 CMD
# .venv\Scripts\Activate.ps1        # 🪟 PowerShell

python edge_camera.py
```

Sistem akan:
1. 📹 Detect kamera (atau tampilkan list jika ada lebih dari satu)
2. 🎯 Pilih kamera yang akan dipakai
3. 🧙 **Jika belum kalibrasi**: jalankan wizard kalibrasi otomatis
4. 🔍 Setelah kalibrasi: masuk **mode inspeksi**

#### 🎬 Argumen CLI Opsional

```bash
python edge_camera.py --camera 0     # Skip selector, pakai kamera index 0
python edge_camera.py -c 1           # Shorthand
python edge_camera.py --camera=2     # Format =
```

### 🌐 Browser — Dashboard

Buka browser, akses: **http://localhost:3000**

> ⚠️ **JANGAN** double-click `index.html` dari file explorer. **Selalu** akses via `http://localhost:3000`. Kalau tidak, fetch API gagal karena CORS.

### ⌨️ Hotkey saat Running

| Key | Aksi |
|-----|------|
| `SPACE` | Force inspection (kirim ke API) |
| `A` | Toggle auto-send |
| `C` | Re-run wizard kalibrasi |
| `R` | Register objek manual ke katalog |
| `U` | Toggle auto-register |
| `V` | Toggle mask preview (debug) |
| `L` | Toggle Live-Cal mode (handheld) |
| `[` `]` | Cycle / lock profil aktif |
| `X` | Clear profile lock |
| `D` | Hapus profil aktif |
| `Q` / `ESC` | Keluar |

---

## 🎓 Alur Program (Penjelasan Semantik)

> 🐣 Bagian ini menjelaskan **apa yang sistem lakukan** dalam bahasa sehari-hari, supaya pemula tahu kenapa harus melakukan tiap langkah.

### 🧠 Konsep 1: Kalibrasi (Calibration)

#### 🎲 Analogi

Bayangkan kamu mau ngukur cabai dengan mata. Tanpa referensi, kamu nggak bisa bilang "ini 5 cm". Tapi kalau kamu tahu **jari telunjuk = 8 cm**, kamu bisa konversi: "cabai ini 60% panjang jari, jadi 4.8 cm".

#### 🔬 Aplikasi ke Kamera

Kamera komputer hanya tahu **jumlah pixel**. Kalibrasi = mengajari sistem:

```
"1 mm = berapa pixel di kameramu?"
```

Kita pakai KTP karena ukurannya **pasti** 85.6 × 53.98 mm.

#### 🧙 Langkah Kalibrasi (Wizard)

Saat pertama jalankan `edge_camera.py`, wizard otomatis muncul. Tampilkan KTP ke kamera dan ikuti panduan 4-stage:

<table>
<tr>
<th width="20%">Stage</th>
<th width="40%">Yang Harus Dilakukan</th>
<th width="40%">Status Bar</th>
</tr>
<tr>
<td><strong>1. Detect</strong></td>
<td>Tampilkan KTP ke kamera</td>
<td>🔴 <code>KTP tidak terlihat</code> → 🟢 KTP detected</td>
</tr>
<tr>
<td><strong>2. Containment</strong></td>
<td>Geser KTP supaya reticle (target lingkaran) MASUK ke dalam kotak KTP</td>
<td>🔴 <code>Reticle DI LUAR kotak KTP</code></td>
</tr>
<tr>
<td><strong>3. Centering</strong></td>
<td>Posisikan reticle persis di titik tengah KTP (offset ≤ 4%)</td>
<td>🟠 <code>Geser KTP: offset 50px / max 21px</code></td>
</tr>
<tr>
<td><strong>4. Rotation</strong></td>
<td>Putar KTP sampai LURUS (axis-aligned, tilt ≤ 2°)</td>
<td>🟡 <code>Putar kanan sedikit lagi (1.5 deg)</code></td>
</tr>
<tr>
<td colspan="3" align="center">▼ Semua kondisi terpenuhi ▼</td>
</tr>
<tr>
<td><strong>✅ Lock</strong></td>
<td>Tekan <code>SPACE</code> → konfirmasi <code>Y</code></td>
<td>🟢 <code>PRESISI + LURUS — Tekan [SPACE] untuk kalibrasi</code></td>
</tr>
</table>

#### 🔄 Apa yang Terjadi Setelah SPACE?

```
1. Layar freeze 1.7 detik
2. Capture 50 frame berturut-turut
3. Buang frame outlier (>1.5σ dari median)
4. Hitung skala px/mm dari median 47-50 frame
5. Cross-calibrate via measurement pipeline (rembg + sub-pixel)
6. Simpan ke calibration.json:
   {
     "pixels_per_mm": 9.6502,
     "pixels_per_mm_L": 9.6495,
     "pixels_per_mm_W": 9.6517,
     ...
   }
```

> 💡 **Kalibrasi cuma sekali.** File `calibration.json` boleh dibackup. Tidak perlu ulang kecuali kamera dipindah / diganti / kondisi pencahayaan berubah drastis.

### 🧠 Konsep 2: Object Catalog

#### 🎲 Analogi

Toko grosir punya **katalog produk**: "Indomie = 75g, Sarimi = 65g". Saat barang masuk, mereka cek: "Ini 75g... oh ini Indomie".

Sistem kita mirip. Setiap objek baru yang kamu register disimpan di `objects.json`:

```json
[
  {
    "name": "KTP",
    "L_mm": 85.6,
    "W_mm": 53.98,
    "tol_L": 2.0,
    "tol_W": 2.0,
    "created": "2026-04-27T00:00:00"
  },
  {
    "name": "Voucher",
    "L_mm": 125.0,
    "W_mm": 60.0,
    "tol_L": 1.5,
    "tol_W": 1.5,
    "created": "2026-04-27T01:00:00"
  }
]
```

#### 🔄 Workflow Auto-Match

```
Objek terdeteksi → ukur L, W
       ↓
Cocokkan ke katalog (window ±8mm L & W)
       ↓
   ┌───┴───┐
   ▼       ▼
 MATCH   UNKNOWN
   │       │
   │       └─→ Stabil 2 detik → Prompt nama → Register profil baru
   │
   ▼
Eval GOOD/NOT GOOD vs profile.tol_L, profile.tol_W
   ▼
POST /inspection (anti-spam 2s)
```

### 🧠 Konsep 3: Inspeksi

Setelah kalibrasi + paling tidak satu profil teregister:

| # | Aksi | Sistem Lakukan |
|---|------|----------------|
| 1 | Letakkan objek di depan kamera | rembg neural network → mask |
| 2 | Aim reticle ke tengah objek | Skin filter buang jari/tangan |
| 3 | Tunggu buffer penuh (`Buf:15/15`) | MORPH_CLOSE seal interior pattern |
| 4 | Status muncul di HUD | Center-weighted contour scoring |
| 5 | Kalau auto-send ON: data terkirim | approxPolyDP → cornerSubPix sub-pixel |
| 6 | Dashboard update | L_mm, W_mm dihitung & median 15 frame |
| 7 | History bertambah | Match ke catalog → GOOD/NOT GOOD → POST API |

### 🗺️ Diagram Alur Lengkap

```
┌──────────────────────────────────────────────────────────────────────┐
│                       PERTAMA KALI RUN                               │
└──────────────────────────────────────────────────────────────────────┘

  python edge_camera.py
       │
       ▼
  Cek calibration.json ada?
       │
       ├─ TIDAK ─→ ┌─────────────────────────────────┐
       │           │  WIZARD KALIBRASI 4-STAGE       │
       │           │   1. Detect KTP                 │
       │           │   2. Reticle inside box         │
       │           │   3. Reticle at center (≤4%)    │
       │           │   4. KTP axis-aligned (≤2°)     │
       │           │   ↓ SPACE → Confirm Y           │
       │           │   ↓ Capture 50 frames           │
       │           │   ↓ Outlier reject 1.5σ         │
       │           │   ↓ Save calibration.json       │
       │           └─────────────────────────────────┘
       │
       └─ YA ──→  Skip wizard, langsung mode inspeksi


┌──────────────────────────────────────────────────────────────────────┐
│                          MODE INSPEKSI                               │
└──────────────────────────────────────────────────────────────────────┘

  Frame in (~30 fps)
       ▼
  ┌─────────────────────────────────────────┐
  │ 1. rembg neural network → mask          │
  │ 2. YCrCb skin filter                    │
  │ 3. MORPH_CLOSE 21×21 seal interior      │
  │ 4. Edge-touch reject + center scoring   │
  │ 5. Pilih kontur terbaik                 │
  │ 6. approxPolyDP → cornerSubPix          │
  │ 7. L_px, W_px → ÷ ppmm → L_mm, W_mm     │
  │ 8. Median 15 frames                     │
  └─────────────────────────────────────────┘
       ▼
  Match ke catalog?
       │
       ├─ MATCH ──→ Eval GOOD/NOT GOOD
       │            │
       │            └─→ POST /inspection (anti-spam 2s)
       │                         │
       │                         ▼
       │                  Dashboard update tiap 5s
       │
       └─ UNKNOWN ─→ Stabil 2 detik → Prompt nama → Register profil baru
```

---

## 🧰 Skenario Penggunaan Umum

### 🏭 Skenario 1: Quality Control UMKM Packaging

**Konteks**: UMKM produksi label snack 1000 unit/hari, target dimensi 80×40mm ±1mm.

| Setup | Operation |
|-------|-----------|
| Mount HP di tripod 30cm di atas conveyor | Label lewat di bawah kamera |
| Kalibrasi sekali pakai KTP | Auto-detect → GOOD/NOT GOOD → log |
| Register profil "Label" via SPACE | Operator monitor dashboard |
| Set `tol_L: 1.0, tol_W: 1.0` | NG di-reject manual oleh operator |

**Hasil**: 950 OK, 50 NG/hari → tracked di dashboard.

### 🔧 Skenario 2: Spot-check Sparepart

**Konteks**: Bengkel cek dimensi gear bekas, target 35×35mm ±0.5mm.

```
1. Kalibrasi pakai KTP saat receive batch sparepart
2. Register profil "Gear-A35" via SPACE
3. Pengukuran:
   • Letakkan gear di meja
   • Aim HP ke gear (reticle ke tengah)
   • Tunggu Buf:15/15
   • Status: GOOD / NOT GOOD muncul
4. Reject yang NOT GOOD
```

### 🎓 Skenario 3: Demo Akademik / Mata Kuliah

**Konteks**: Demo computer vision di matkul Pengolahan Citra Digital.

```
1. Run server + edge_camera di laptop dosen
2. Demo wizard kalibrasi (3 menit)
3. Tampilkan dashboard live
4. Demo akurasi:
   • Ukur KTP → 85.60 × 53.98 mm presisi
   • Ukur kartu kredit → ~85.6 × 53.98 (sama)
   • Ukur ID badge → dimensi spesifik badge
5. Diskusi: rembg vs adaptive threshold,
   sub-pixel refinement, cross-calibration concept
```

---

## 🔬 Detail Teknis Algoritma

### 🤖 1. Background Removal — rembg + U2-Net

**Model**: U2-Net trained pada [DUTS dataset](http://saliencydetection.net/duts/) untuk salient object detection. Run di **ONNX Runtime** untuk cross-platform.

**Pipeline**:
```python
frame_bgr → cv2.cvtColor(BGR2RGB) → rgb
rgb → rembg.remove(only_mask=True) → grayscale_mask (0-255)
grayscale_mask → cv2.threshold(127) → binary_mask
binary_mask → MORPH_CLOSE(5×5, iter=1) → cleaned_mask
```

**Performa**:
| CPU | Latensi | FPS |
|-----|---------|-----|
| Apple Silicon M1/M2 | 200-300ms | 3-5 fps |
| Intel i5 (10th gen) | 400-600ms | 1.5-2.5 fps |
| Intel i7+ / Ryzen 7 | 250-400ms | 2.5-4 fps |
| NVIDIA GPU + CUDA | 30-80ms | 12-30 fps |

### 🖐️ 2. Skin Filter — YCrCb Color Space

**Mengapa YCrCb (bukan HSV)?**
- Pisahkan luminance (Y) dari chrominance (Cr, Cb)
- Skin tones di seluruh dunia jatuh di range Cr ∈ [133, 173], Cb ∈ [77, 127]
- Robust terhadap lighting changes

**Sumber**: Phung, Bouzerdoum, Chai (2002) — "A Novel Skin Color Model in YCbCr Color Space and Its Application to Human Face Detection"

```python
ycrcb = cv2.cvtColor(frame, COLOR_BGR2YCrCb)
skin_mask = cv2.inRange(ycrcb, (0, 133, 77), (255, 173, 127))
skin_mask = MORPH_CLOSE(skin_mask, 5×5, iter=2)
skin_mask = cv2.dilate(skin_mask, 5×5, iter=1)  # halo pixels
object_mask = object_mask AND NOT skin_mask
```

### 🧱 3. Aggressive Morphological Sealing

Untuk objek dengan pattern kompleks (KTP belakang dengan pita merah-putih, foto MoU, sidik jari), rembg bisa memfragmentasi mask. Solusi:

```python
seal_kernel = MORPH_RECT(21×21)
mask = cv2.morphologyEx(mask, MORPH_CLOSE, seal_kernel, iterations=2)
```

**Properties**:
- `MORPH_CLOSE = dilate → erode` (mathematically restore boundary)
- Fill internal gaps ≤ 21px (per iteration)
- Iter=2 → bridges gaps ≤ 42px
- Outer boundary preserved

### 🎯 4. Center-Weighted Contour Selection

**Bukan** pilih kontur terbesar (tangan bisa lebih besar dari objek).

**Score function**:
```
score = 0.55 × center_score + 0.20 × size_score + 0.25 × rectangularity
```

| Komponen | Formula | Range |
|----------|---------|-------|
| `center_score` | `1.0 - min(dist_from_center / (diag × 0.35), 1.0)` | [0, 1] |
| `size_score` | `min(area / (frame_area × 0.08), 1.0)` | [0, 1] |
| `rectangularity` | `area / minAreaRect.area` | [0, 1] |

Kontur dekat reticle dengan bentuk rectangular menang.

### 🔍 5. Sub-Pixel Corner Refinement (Inti Akurasi)

```python
# Step 1: Find 4-corner approximation
peri = cv2.arcLength(contour, True)
for eps in [0.01, 0.015, 0.02, 0.025, 0.03, 0.04]:
    approx = cv2.approxPolyDP(contour, eps × peri, True)
    if len(approx) == 4 and cv2.isContourConvex(approx):
        break

# Step 2: Sub-pixel refine each corner
corners = approx.reshape(-1, 1, 2).astype(np.float32)
refined = cv2.cornerSubPix(
    gray, corners,
    winSize=(7, 7),
    zeroZone=(-1, -1),
    criteria=(EPS + MAX_ITER, 40, 0.001)
)
```

`cornerSubPix` menggunakan **saddle-point detection di gradient image**. Untuk kartu dengan tepi tajam:

| Method | Akurasi |
|--------|---------|
| `minAreaRect(contour)` | ~2 px error |
| `minAreaRect(convexHull)` | ~1 px error |
| `cornerSubPix` | **<0.1 px** |

**L_px, W_px dari rata-rata sisi paralel** (cancel small per-corner error):

```python
edges = sorted([dist(c[i], c[(i+1)%4]) for i in range(4)], reverse=True)
L_px = (edges[0] + edges[1]) / 2  # rata-rata 2 sisi panjang
W_px = (edges[2] + edges[3]) / 2  # rata-rata 2 sisi pendek
```

### ⚖️ 6. Anisotropic Calibration

**Dua skala terpisah** untuk sisi panjang vs pendek:

```python
PIXELS_PER_MM_L = L_px_KTP / 85.6     # untuk sisi panjang objek
PIXELS_PER_MM_W = W_px_KTP / 53.98    # untuk sisi pendek objek
```

**Mengapa?** Sub-pixel inset dari rembg + morphology bisa berbeda untuk sisi panjang vs pendek. Skala terpisah cancel error secara independen.

```python
L_mm = L_px / cfg.PIXELS_PER_MM_L
W_mm = W_px / cfg.PIXELS_PER_MM_W
```

### 🔄 7. Cross-Calibration Pipeline-Aware

Wizard kalibrasi **menggunakan pipeline pengukuran yang sama** (rembg → skin → close → 4-corner refine), bukan strict edge detector. Bias sistematik dari pipeline cancel out:

```
Calibration time:  L_px_pipeline / 85.6 → ppmm_L_saved
Measurement time:  L_px_pipeline / ppmm_L_saved → L_mm = 85.6 ✓
```

**Plus safeguards**:
- 50-frame averaging
- 1.5σ outlier rejection
- Aspect ratio validation (KTP 1.585 ±10%)
- Sanity check: ppmm change <25% dari strict baseline

### 🧭 8. Rotation Lock

KTP harus axis-aligned saat kalibrasi karena tilted card → perspective distortion → false ppmm.

```python
long_angle = np.degrees(np.arctan2(long_dy, long_dx))
norm_angle = long_angle % 180

if norm_angle <= 45:
    tilt_signed = norm_angle           # near horizontal axis
elif norm_angle <= 135:
    tilt_signed = norm_angle - 90      # near vertical axis
else:
    tilt_signed = norm_angle - 180     # near horizontal (wraparound)

is_axis_aligned = abs(tilt_signed) <= 2.0
```

**Sign of `tilt_signed`** → real-time direction guidance:
- `tilt_signed > 0` → KTP tilted visual-CW → user rotates CCW = **"putar kiri"**
- `tilt_signed < 0` → KTP tilted visual-CCW → user rotates CW = **"putar kanan"**

### 📊 9. Median Smoother

Runtime measurements di-median selama **15 frames**:

```python
class MedianSmoother:
    def __init__(self, n=15):
        self.buf_L = deque(maxlen=n)
        self.buf_W = deque(maxlen=n)

    def add(self, L, W):
        self.buf_L.append(L)
        self.buf_W.append(W)

    def get(self):
        if len(self.buf_L) < 3:
            return None, None
        return float(np.median(self.buf_L)), float(np.median(self.buf_W))
```

**Trade-off**:
- Lebih banyak sample → lebih stabil tapi latensi tinggi
- 15 samples @ 30fps ≈ 0.5s latensi
- Robust ke outlier frame (median, bukan mean)

---

## ⚙️ Konfigurasi & Tuning

Semua tunable parameters ada di `Config` class di `edge_camera.py:63`.

### 📐 Kalibrasi (KTP Strict Detection)

| Parameter | Default | Range | Fungsi |
|-----------|:-------:|:-----:|--------|
| `REF_WIDTH_MM` | 85.6 | — | Panjang KTP standar (mm) |
| `REF_HEIGHT_MM` | 53.98 | — | Lebar KTP standar (mm) |
| `KTP_RATIO_TOLERANCE` | 0.06 | 0.03–0.10 | ±N% dari aspect ratio 1.585 |
| `KTP_MIN_SOLIDITY` | 0.90 | 0.85–0.95 | Min solidity untuk dianggap rectangular |
| `KTP_MIN_AREA_FRAC` | 0.02 | 0.01–0.10 | Min area fraction frame (2% = jauh) |

### 🎬 Cross-Calibration

| Parameter | Default | Range | Fungsi |
|-----------|:-------:|:-----:|--------|
| `CAL_AVG_FRAMES` | 50 | 10–100 | Frame yang di-median saat cross-cal |
| `CAL_OUTLIER_SIGMA` | 1.5 | 1.0–3.0 | Reject samples >Nσ dari median |
| `CAL_MAX_TILT_DEG` | 2.0 | 0.5–5.0 | Max tilt saat kalibrasi (°) |
| `LIVE_CAL_MODE` | False | bool | Default OFF (static cal mode) |
| `LIVE_CAL_MIN_CONSISTENCY` | 0.85 | 0.7–0.95 | Min W/H consistency live mode |

### 🔍 Pengukuran Runtime

| Parameter | Default | Range | Fungsi |
|-----------|:-------:|:-----:|--------|
| `MATCH_WINDOW_MM` | 8.0 | 2.0–20.0 | Auto-match window ±N mm |
| `DEFAULT_TOL_MM` | 2.0 | 0.5–5.0 | Toleransi default profil baru |
| `AUTO_REGISTER_SECS` | 2.0 | 1.0–10.0 | Detik unknown stabil sebelum prompt |
| `SMOOTH_SAMPLES` | 15 | 5–30 | Rolling median window |
| `MIN_SEND_INTERVAL` | 2.0 | 0.5–10.0 | Anti-spam interval (s) |
| `CHANGE_THRESHOLD` | 0.05 | 0.01–0.5 | Min change to send (mm) |
| `MIN_CONTOUR_AREA` | 2000 | 500–10000 | Min kontur area (px²) |
| `CONFIDENCE_MIN` | 0.7 | 0.3–0.95 | Min confidence untuk send |

### 🎨 Mask & Segmentasi

| Parameter | Default | Range | Fungsi |
|-----------|:-------:|:-----:|--------|
| `BG_DIFF_THRESHOLD` | 25 | 10–50 | Floor threshold untuk dominant-color mask |

### 📷 Camera

| Parameter | Default | Fungsi |
|-----------|:-------:|--------|
| `CAMERA_INDEX` | 0 | Default camera index |
| `FRAME_WIDTH` | 1920 | Resolution width (px) |
| `FRAME_HEIGHT` | 1080 | Resolution height (px) |
| `FPS` | 30 | Target FPS |

### 🌐 API

| Parameter | Default | Fungsi |
|-----------|:-------:|--------|
| `API_URL` | `http://localhost:3000/inspection` | Backend endpoint |
| `API_TIMEOUT` | 3 | Request timeout (s) |

### 🎨 HUD Colors (BGR)

| Konstanta | Default | Penggunaan |
|-----------|:-------:|------------|
| `C_OK` | `(50, 210, 50)` | Hijau status OK |
| `C_NG` | `(50, 50, 220)` | Merah status NG |
| `C_CYAN` | `(220, 200, 0)` | Cyan kontur objek |
| `C_YELLOW` | `(0, 215, 255)` | Kuning warning |
| `C_DARK` | `(15, 20, 38)` | Background dark panel |

### 🟢 Server Config (`server.js`)

| Parameter | Default | Fungsi |
|-----------|:-------:|--------|
| `PORT` | 3000 | HTTP port |
| `DATA_FILE` | `data/inspections.json` | Storage path |

---

## 🔌 API Reference

### `GET /inspection`

Ambil semua data inspeksi, sorted by ID descending (terbaru dulu).

**Response (200)**:
```json
{
  "success": true,
  "count": 234,
  "data": [
    {
      "id": 234,
      "object_name": "KTP",
      "dimension_mm": 85.604,
      "width_mm": 53.991,
      "confidence": 0.99,
      "status": "OK",
      "timestamp": "2026-04-27T02:14:18.236Z"
    }
  ]
}
```

### `POST /inspection`

Tambah satu data inspeksi.

**Request Body**:
```json
{
  "dimension_mm": 85.604,
  "width_mm": 53.991,
  "status": "OK",
  "confidence": 0.99,
  "object_name": "KTP"
}
```

| Field | Type | Wajib? | Range / Format |
|-------|------|:------:|----------------|
| `dimension_mm` | number | ✅ | > 0 |
| `status` | string | ✅ | `"OK"` \| `"NG"` |
| `width_mm` | number | ⬜ | > 0 |
| `confidence` | number | ⬜ | 0.0–1.0 |
| `object_name` | string | ⬜ | trim, non-empty |

**Response (201)**:
```json
{
  "success": true,
  "message": "Data berhasil disimpan.",
  "data": { /* entry yang baru disimpan dengan id auto-increment */ }
}
```

**Response (400)** — invalid:
```json
{
  "success": false,
  "message": "dimension_mm wajib diisi."
}
```

### `DELETE /inspection`

Hapus semua data.

**Response (200)**:
```json
{
  "success": true,
  "message": "Semua data berhasil dihapus."
}
```

### 📞 Contoh cURL

```bash
# Tambah data manual
curl -X POST http://localhost:3000/inspection \
  -H "Content-Type: application/json" \
  -d '{
    "dimension_mm": 85.6,
    "width_mm": 53.98,
    "status": "OK",
    "confidence": 0.95,
    "object_name": "KTP-Test"
  }'

# Ambil semua (pretty print dengan jq)
curl -s http://localhost:3000/inspection | jq

# Hapus semua
curl -X DELETE http://localhost:3000/inspection
```

---

## 📁 Struktur Project

```
CAPSTONE/
│
├── 📷 EDGE DEVICE
│   ├── edge_camera.py              ⭐ Edge — Python + OpenCV + rembg
│   └── requirements.txt            ⭐ Python dependencies
│
├── 🟢 BACKEND
│   ├── server.js                   ⭐ Backend — Node.js + Express
│   ├── package.json                ⭐ Node.js dependencies
│   └── package-lock.json           Locked Node.js versions
│
├── 🌐 FRONTEND
│   ├── index.html                  Dashboard markup
│   ├── script.js                   Frontend logic + Chart.js
│   └── style.css                   Dark theme stylesheet
│
├── 📚 DOKUMENTASI
│   ├── README.md                   ⭐ Dokumen ini
│   ├── LICENSE                     MIT License
│   └── CONTRIBUTING.md             Panduan kontribusi
│
├── 💾 RUNTIME (auto-generated, di-gitignore)
│   ├── calibration.json            px/mm scale (anisotropic)
│   ├── objects.json                Object catalog
│   └── data/inspections.json       History pengukuran
│
└── 🔧 CONFIG
    └── .gitignore                  Git ignore rules
```

| Legend | Deskripsi |
|:------:|-----------|
| ⭐ | File utama yang kamu edit/jalankan |
| 💾 | File generated otomatis runtime |

---

## 🛠️ Troubleshooting

### 🔴 Kamera tidak terdetect

**Gejala**: `[ERROR] No camera detected or selection cancelled!`

**Solusi per OS**:
| OS | Aksi |
|----|------|
| 🍎 macOS | **Settings > Privacy & Security > Camera** → enable Terminal/Python |
| 🪟 Windows | **Settings > Privacy > Camera** → "Allow apps to access your camera" |
| 🐧 Linux | Check `ls /dev/video*` — pastikan device ada |

**Phone webcam (DroidCam/iVCam)**:
- Pastikan app HP **dan** PC sudah connected
- Test di app sumber (preview di app DroidCam dulu)
- Coba `python edge_camera.py --camera 1` untuk index lain

### 🔴 Wizard kalibrasi gagal "KTP tidak terdeteksi"

**Penyebab umum**:
1. Pencahayaan terlalu rendah → tepi KTP tidak kontras
2. KTP terlalu jauh (< 2% area frame)
3. Latar terlalu rame
4. KTP miring ekstrem (> 30°)

**Solusi**:
- 💡 Tambah lampu (LED desk lamp dari samping)
- 📏 Dekatkan KTP ke kamera (biar lebih besar di frame)
- 🎨 Pakai latar polos (kertas A3 putih atau hitam)
- 📐 Luruskan KTP secara fisik dulu

### 🟠 Mask "menjalar" / hasil tidak bersih

**Penyebab**: tekstur meja, shadow, atau auto-exposure HP yang berubah-ubah.

**Solusi**:
1. Tekan `[V]` saat run → tampil mask preview di pojok kanan atas
2. Matikan auto-exposure di app HP camera (DroidCam settings)
3. Pakai latar polos
4. Tambah pencahayaan dari samping (kurangi shadow)

### 🟠 Kalibrasi tampak benar tapi pengukuran melenceng

**Penyebab**: pipeline pengukuran berubah dari saat kalibrasi (mungkin update kode atau setting kamera berubah).

**Solusi**:
```bash
rm calibration.json
python edge_camera.py
# Wizard otomatis muncul ulang, recalibrate
```

### 🔴 `pip install` error: "externally-managed-environment"

**Penyebab**: Homebrew Python (macOS) atau Debian Python tidak izinkan pip install global.

**Solusi**: PAKAI virtual environment (Langkah 5 di [Instalasi](#-instalasi-untuk-pemula-sama-sekali))

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 🔴 Server "Cannot find module 'express'"

**Solusi**:
```bash
cd CAPSTONE
npm install
```

### 🟠 Dashboard tidak update / "Tidak terhubung ke server"

**Penyebab umum**:
1. `server.js` tidak running
2. Port 3000 dipakai aplikasi lain
3. Browser akses dari `file://` bukan `http://`

**Solusi**:
```bash
# Cek server running
ps aux | grep "node server.js"

# Cek port
lsof -i :3000              # macOS/Linux
netstat -ano | findstr :3000   # Windows

# Restart server
# Ctrl+C di terminal 1, lalu:
node server.js
```

### 🟠 rembg lambat (1-2 fps)

**Penyebab**: u2netp model run di CPU. Sesuai design.

**Mitigasi**:
- Sudah cukup untuk demo workflow (HP holds card, take measurement)
- Untuk speed: install `onnxruntime-gpu` jika punya CUDA GPU
- Atau ganti model: edit di `edge_camera.py` `_get_rembg_session("u2netp")` jadi `"silueta"` (lebih cepat tapi kurang akurat)

### 🔴 ImportError: cannot import name 'rembg' / 'cv2'

**Penyebab**: venv tidak aktif atau requirements.txt belum di-install.

**Solusi**:
```bash
# Aktifkan venv dulu
source .venv/bin/activate    # macOS/Linux

# Cek installed
pip list | grep -E "rembg|opencv"

# Re-install kalau perlu
pip install -r requirements.txt
```

---

## 🗺️ Roadmap

### v2.1 — Q3 2026
- [ ] Multi-object simultaneous measurement (multiple objects in one frame)
- [ ] Calibration profile persistence per camera setup
- [ ] Export ke CSV/Excel dari dashboard
- [ ] Authentication di dashboard (multi-user role)
- [ ] Dark/light theme toggle

### v2.2 — Q4 2026
- [ ] Live-cal handheld mode improvements (continuous KTP tracking)
- [ ] Stereo camera support untuk 3D measurement
- [ ] Telegram bot integration untuk NG alerts
- [ ] WebSocket untuk real-time push (replace polling)
- [ ] PDF report generation

### v3.0 — 2027
- [ ] Custom object classifier (TensorFlow Lite) untuk type recognition
- [ ] Edge deployment ke Raspberry Pi 5
- [ ] Database backend (PostgreSQL) untuk scale beyond 10k records
- [ ] Mobile app native (React Native)
- [ ] Cloud sync (Firebase / Supabase)

---

## 👥 Tim Pengembang

<div align="center">

### **Capstone Project — Topik A3 — Kelompok 2**
### **Fakultas Ilmu Komputer · Universitas Brawijaya**

</div>

| Role | Nama | Kontribusi |
|------|------|------------|
| 🔧 **Lead Developer** | Hilmy Raihan Kindy | Edge pipeline, calibration wizard, sub-pixel refinement |
| 🎨 **Frontend & UX** | _[Nama Anggota]_ | Dashboard, Chart.js integration, status UI |
| 🧪 **QA & Testing** | _[Nama Anggota]_ | Calibration validation, accuracy benchmarking |
| 📋 **Project Lead** | _[Nama Anggota]_ | Coordination, documentation, demo |

---

## 🤝 Kontribusi

Kami terbuka untuk kontribusi dari mahasiswa Filkom UB dan komunitas open-source.

```bash
# 1. Fork repository di GitHub
# 2. Clone fork
git clone https://github.com/<your-username>/CAPSTONE.git
cd CAPSTONE

# 3. Buat branch fitur
git checkout -b feat/nama-fitur

# 4. Commit perubahan
git add .
git commit -m "feat: deskripsi singkat"

# 5. Push & buka Pull Request
git push origin feat/nama-fitur
```

Detail panduan di [CONTRIBUTING.md](./CONTRIBUTING.md).

### 📝 Convention Pesan Commit

| Prefix | Untuk |
|--------|-------|
| `feat:` | Fitur baru |
| `fix:` | Bug fix |
| `docs:` | Dokumentasi |
| `refactor:` | Refactor (no behavior change) |
| `perf:` | Performance improvement |
| `test:` | Add / fix tests |
| `chore:` | Maintenance |

---

## 📄 Lisensi

```
MIT License
═════════════════════════════════════════════════════════════
© 2026 Capstone A3 Kelompok 2 — Fakultas Ilmu Komputer
                              Universitas Brawijaya

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, subject to
attribution.

⭐ Penggunaan komersial WAJIB mencantumkan:
   "Powered by Capstone A3 Kelompok 2,
    Filkom Universitas Brawijaya"

⭐ Penggunaan akademik dengan referensi yang sesuai:
   bebas tanpa biaya.
═════════════════════════════════════════════════════════════
```

Detail lengkap di file [LICENSE](./LICENSE).

---

## 📞 Kontak

| Channel | Detail |
|---------|--------|
| 🐙 **GitHub** | https://github.com/ChrozaGaming/CAPSTONE |
| 📧 **Email** | hilmyraihankindy@gmail.com |
| 🐛 **Issues** | [GitHub Issues](https://github.com/ChrozaGaming/CAPSTONE/issues) |
| 🎓 **Institusi** | Fakultas Ilmu Komputer, Universitas Brawijaya |

---

## 🙏 Acknowledgements

- **OpenCV** — Foundation computer vision library
- **rembg** — U2-Net background removal by [Daniel Gatis](https://github.com/danielgatis/rembg)
- **U2-Net** — Qin et al., _"U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection"_ (2020)
- **Phung et al., 2002** — Skin segmentation in YCrCb color space
- **ISO/IEC 7810 ID-1** — Card dimension international standard
- **Filkom Universitas Brawijaya** — Atas dukungan akademik dan platform Capstone

---

<div align="center">

```
═══════════════════════════════════════════════════════════════════════
  © 2026 — CAPSTONE TOPIK A3 KELOMPOK 2
  FAKULTAS ILMU KOMPUTER · UNIVERSITAS BRAWIJAYA
═══════════════════════════════════════════════════════════════════════
```

[⬆ Kembali ke atas](#-automated-dimensional-inspection-system)

</div>
