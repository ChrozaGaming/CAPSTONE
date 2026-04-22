/**
 * server.js
 * Backend untuk Automated Dimensional Inspection Dashboard
 * Node.js + Express REST API
 * 
 * Endpoints:
 *   POST   /inspection  - Tambah data inspeksi baru
 *   GET    /inspection  - Ambil semua data inspeksi
 *   DELETE /inspection  - Hapus semua data inspeksi
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Path file penyimpanan data JSON
const DATA_FILE = path.join(__dirname, 'data', 'inspections.json');

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());                          // Izinkan request dari frontend
app.use(express.json());                  // Parse JSON body
app.use(express.static(__dirname));       // Sajikan file statis (index.html, dll)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pastikan direktori & file data tersedia.
 * Jika belum ada, buat secara otomatis.
 */
function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

/**
 * Baca semua data inspeksi dari file JSON.
 * @returns {Array} Array objek inspeksi
 */
function readData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Tulis data ke file JSON.
 * @param {Array} data - Array objek inspeksi
 */
function writeData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /inspection
 * Ambil semua data inspeksi, diurutkan dari terbaru.
 */
app.get('/inspection', (req, res) => {
  const data = readData();
  // Urutkan: ID terbesar (terbaru) di atas
  const sorted = [...data].sort((a, b) => b.id - a.id);
  res.json({ success: true, count: sorted.length, data: sorted });
});

/**
 * POST /inspection
 * Simpan satu data inspeksi baru.
 * Body: { dimension_mm: number, status: "OK"|"NG" }
 */
app.post('/inspection', (req, res) => {
  const { dimension_mm, status } = req.body;

  // Validasi input
  if (dimension_mm === undefined || dimension_mm === null) {
    return res.status(400).json({ success: false, message: 'dimension_mm wajib diisi.' });
  }
  if (!['OK', 'NG'].includes(status)) {
    return res.status(400).json({ success: false, message: 'status harus "OK" atau "NG".' });
  }

  const data = readData();

  // Buat ID otomatis (increment)
  const newId = data.length > 0 ? Math.max(...data.map(d => d.id)) + 1 : 1;

  const newEntry = {
    id: newId,
    dimension_mm: parseFloat(Number(dimension_mm).toFixed(3)),
    status: status,
    timestamp: new Date().toISOString()
  };

  data.push(newEntry);
  writeData(data);

  console.log(`[+] Inspeksi #${newId} | ${dimension_mm} mm | ${status}`);
  res.status(201).json({ success: true, message: 'Data berhasil disimpan.', data: newEntry });
});

/**
 * DELETE /inspection
 * Hapus semua data inspeksi.
 */
app.delete('/inspection', (req, res) => {
  writeData([]);
  console.log('[!] Semua data inspeksi dihapus.');
  res.json({ success: true, message: 'Semua data berhasil dihapus.' });
});

// ─── Root redirect ke dashboard ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Automated Dimensional Inspection - Backend     ║');
  console.log(`║   Server berjalan di http://localhost:${PORT}      ║`);
  console.log('╚══════════════════════════════════════════════════╝');
});
