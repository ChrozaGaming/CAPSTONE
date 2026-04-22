# Automated Dimensional Inspection Dashboard

![Python](https://img.shields.io/badge/Python-3.x-blue?logo=python)
![Node.js](https://img.shields.io/badge/Node.js-Express-green?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-green)
![Status](https://img.shields.io/badge/Status-Active-brightgreen)

## 📖 Deskripsi Proyek

**Automated Dimensional Inspection Dashboard** adalah sistem terintegrasi untuk inspeksi dimensional otomatis berbasis IoT dan machine vision. Proyek ini menggabungkan:

- 📷 **Edge Device** (Python OpenCV) untuk capture dan processing gambar
- 🖥️ **Backend Server** (Node.js + Express) untuk menyimpan & memanage data
- 📊 **Dashboard Frontend** (HTML/CSS/JS) untuk visualisasi real-time

Sistem ini dirancang untuk **Capstone Project Kelompok 2** dengan fokus pada industrial inspection dan quality control.

---

## ✨ Fitur Utama

- ✅ **Real-time Dimensional Inspection** - Analisis ukuran objek secara otomatis
- ✅ **IoT Edge Processing** - Python edge device untuk local processing
- ✅ **Live Dashboard** - Visualisasi data dengan Chart.js
- ✅ **Pass/Fail Detection** - Otomatis kategorisasi OK/NG berdasarkan toleransi
- ✅ **RESTful API** - Integration-ready dengan berbagai platform
- ✅ **Android Integration** - WebView support untuk aplikasi mobile
- ✅ **Data Logging** - History inspeksi tersimpan di database

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Edge Device** | Python 3.x, OpenCV, NumPy |
| **Backend** | Node.js, Express, JSON (File-based) |
| **Frontend** | HTML5, CSS3, JavaScript, Chart.js |
| **Integration** | REST API, cURL, WebView Android |
| **License** | MIT |

---

## 👥 Tim Pengembang

**Kelompok 2 - Capstone Project**

- 🔧 **Developer**: [Nama Anggota]
- 🎨 **UI/UX**: [Nama Anggota]
- 📋 **Project Lead**: [Nama Anggota]

*(Update dengan nama anggota tim)*

---

## 🚀 Quick Start

### 📋 Prasyarat

Sebelum menjalankan, pastikan **Node.js** sudah terinstall:

1. Download di: https://nodejs.org/en/download  
   *(Pilih versi LTS — recommended)*
2. Jalankan installer, centang **"Add to PATH"**
3. Restart terminal/Command Prompt setelah install
4. Verifikasi dengan: `node --version` dan `npm --version`

### ⚡ Langkah-Langkah

**Langkah 1 — Install Dependency**

```bash
npm install
```

**Langkah 2 — Jalankan Backend Server**

```bash
node server.js
```

Output yang diharapkan:
```
╔══════════════════════════════════════════════════╗
║   Automated Dimensional Inspection - Backend     ║
║   Server berjalan di http://localhost:3000       ║
╚══════════════════════════════════════════════════╝
```

**Langkah 3 — Buka Frontend Dashboard**

Buka browser dan akses: **http://localhost:3000**

> ⚠️ Jangan buka `index.html` langsung dari file explorer (double-click),  
> karena fetch API akan gagal karena CORS. Selalu akses via `http://localhost:3000`.

---

## 🧪 Testing & Simulasi

### Via Tombol UI
Klik tombol **"⚡ Simulasi Inspeksi"** di dashboard.  
Ini akan mengirim satu data inspeksi acak ke server.

### Via cURL (Terminal)

```bash
# Tambah data OK manual
curl -X POST http://localhost:3000/inspection \
  -H "Content-Type: application/json" \
  -d "{\"dimension_mm\": 10.2, \"status\": \"OK\"}"

# Tambah data NG manual
curl -X POST http://localhost:3000/inspection \
  -H "Content-Type: application/json" \
  -d "{\"dimension_mm\": 11.3, \"status\": \"NG\"}"

# Lihat semua data
curl http://localhost:3000/inspection

# Hapus semua data
curl -X DELETE http://localhost:3000/inspection
```

### Dari Python (Edge Device)

```python
import requests

# Kirim hasil inspeksi dari edge device ke dashboard
data = {
    "dimension_mm": 10.15,
    "status": "OK"
}
response = requests.post("http://localhost:3000/inspection", json=data)
print(response.json())
```

---

## 📁 Struktur Project

```
CAPSTONE/
├── index.html              ← Frontend Dashboard
├── style.css               ← Stylesheet (Dark Theme)
├── script.js               ← Frontend Logic & Chart
├── server.js               ← Backend (Node.js + Express)
├── edge_camera.py          ← Edge Device (Python + OpenCV)
├── package.json            ← NPM Dependencies
├── inspections.json        ← Data Storage
├── README.md               ← Dokumentasi (File ini)
├── LICENSE                 ← MIT License
├── CONTRIBUTING.md         ← Panduan Kontribusi
└── .gitignore              ← Git Ignore Rules
```

---

## 🔌 API Reference

### GET /inspection
Ambil semua data inspeksi

```bash
curl http://localhost:3000/inspection
```

### POST /inspection
Tambah satu data inspeksi baru

**Request Body:**
```json
{
  "dimension_mm": 10.25,
  "status": "OK"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Data berhasil disimpan.",
  "data": {
    "id": 1,
    "dimension_mm": 10.25,
    "status": "OK",
    "timestamp": "2026-04-21T07:50:00.000Z"
  }
}
```

### DELETE /inspection
Hapus semua data inspeksi

```bash
curl -X DELETE http://localhost:3000/inspection
```

---

## 📱 Android WebView Integration

Untuk integrasi ke WebView Android:

- **Dari Emulator**: `http://10.0.2.2:3000`
- **Dari Device Fisik**: `http://<IP-PC>:3000` (satu jaringan WiFi)

---

## ⚙️ Logika Simulasi

```
Nilai acak antara 9.0 – 11.0 mm
Target: 10.0 mm ± 0.5 mm → OK
Selain itu → NG
```

**Contoh:**
- 9.8 mm → |9.8 - 10.0| = 0.2 ≤ 0.5 → **OK** ✅
- 10.4 mm → |10.4 - 10.0| = 0.4 ≤ 0.5 → **OK** ✅
- 10.7 mm → |10.7 - 10.0| = 0.7 > 0.5 → **NG** ❌
- 9.3 mm  → |9.3 - 10.0| = 0.7 > 0.5 → **NG** ❌

---

## 📚 Dokumentasi Lengkap

- [Edge Device Setup](./docs/EDGE_SETUP.md) - Konfigurasi Python & OpenCV
- [API Documentation](./docs/API.md) - Detail endpoint API
- [Troubleshooting](./docs/TROUBLESHOOTING.md) - Solusi masalah umum

---

## 🤝 Kontribusi

Kami terbuka untuk kontribusi! Silakan baca [CONTRIBUTING.md](./CONTRIBUTING.md) untuk panduan lengkap.

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah **MIT License** - lihat file [LICENSE](./LICENSE) untuk detail.

---

## 📞 Kontak & Support

Jika ada pertanyaan atau issue, silakan buka [GitHub Issues](https://github.com/nabsuc/CAPSTONE/issues).

---

**Made with ❤️ by Kelompok 2 Capstone Project**