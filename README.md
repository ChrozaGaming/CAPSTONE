# Automated Dimensional Inspection Dashboard
## Panduan Instalasi & Menjalankan Sistem

---

## 📋 Prasyarat

Sebelum menjalankan, pastikan **Node.js** sudah terinstall:

1. Download di: https://nodejs.org/en/download  
   *(Pilih versi LTS — recommended)*
2. Jalankan installer, centang **"Add to PATH"**
3. Restart terminal/Command Prompt setelah install
4. Verifikasi dengan: `node --version` dan `npm --version`

---

## 🚀 Cara Menjalankan

### Langkah 1 — Install Dependency

Buka terminal di folder `inspection-dashboard`, lalu jalankan:

```bash
npm install
```

### Langkah 2 — Jalankan Backend Server

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

### Langkah 3 — Buka Frontend Dashboard

Buka browser dan akses: **http://localhost:3000**

> ⚠️ Jangan buka `index.html` langsung dari file explorer (double-click),  
> karena fetch API akan gagal karena CORS. Selalu akses via `http://localhost:3000`.

---

## 🧪 Cara Testing Simulasi

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
inspection-dashboard/
├── index.html        ← Frontend utama (HTML)
├── style.css         ← Stylesheet (dark theme)
├── script.js         ← Logic frontend (fetch, chart, simulasi)
├── server.js         ← Backend Node.js + Express
├── package.json      ← Konfigurasi npm
├── README.md         ← Dokumen ini
└── data/
    └── inspections.json  ← File penyimpanan data (dibuat otomatis)
```

---

## 🔌 API Reference

| Method | Endpoint      | Deskripsi                     |
|--------|---------------|-------------------------------|
| GET    | /inspection   | Ambil semua data inspeksi     |
| POST   | /inspection   | Tambah satu data baru         |
| DELETE | /inspection   | Hapus semua data              |

### POST /inspection — Request Body
```json
{
  "dimension_mm": 10.25,
  "status": "OK"
}
```

### Response
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

---

## 📱 Android WebView Integration

Untuk integrasi ke WebView Android, gunakan URL:  
`http://10.0.2.2:3000` *(dari emulator Android → localhost PC)*  
atau `http://<IP-PC>:3000` *(dari perangkat fisik — pastikan satu jaringan WiFi)*

---

## ⚙️ Logika Simulasi

```
Nilai acak antara 9.0 – 11.0 mm
Target: 10.0 mm ± 0.5 mm → OK
Selain itu → NG
```

Contoh:
- 9.8 mm → |9.8 - 10.0| = 0.2 ≤ 0.5 → **OK** ✅
- 10.4 mm → |10.4 - 10.0| = 0.4 ≤ 0.5 → **OK** ✅
- 10.7 mm → |10.7 - 10.0| = 0.7 > 0.5 → **NG** ❌
- 9.3 mm  → |9.3 - 10.0|  = 0.7 > 0.5 → **NG** ❌
