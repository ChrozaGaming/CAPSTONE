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
  const { dimension_mm, width_mm, status, confidence, object_name } = req.body;

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
    object_name: (typeof object_name === 'string' && object_name.trim()) ? object_name.trim() : null,
    dimension_mm: parseFloat(Number(dimension_mm).toFixed(3)),
    width_mm: (width_mm !== undefined && width_mm !== null) ? parseFloat(Number(width_mm).toFixed(3)) : null,
    confidence: (confidence !== undefined && confidence !== null) ? Number(confidence) : null,
    status: status,
    timestamp: new Date().toISOString()
  };

  data.push(newEntry);
  writeData(data);

  const tag = newEntry.object_name ? `[${newEntry.object_name}] ` : '';
  console.log(`[+] Inspeksi #${newId} ${tag}| L=${dimension_mm} W=${newEntry.width_mm ?? '—'} mm | ${status}`);
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

// ─── Pending Object Naming (Edge ↔ Web hybrid) ────────────────────────────────
//
// Edge mendaftarkan objek baru ke /api/pending → Web menampilkan form di
// dashboard → user mengisi nama. Edge polling /api/pending/:id sampai
// dapat nama. Sejajar dengan terminal input() di edge — mana duluan menang.
//
// In-memory store (ephemeral). Server restart = pending hilang (edge timeout
// dan terminal tetap jalan).

const pendingObjects = new Map();          // id -> {id, L_mm, W_mm, name, created_at, named_at}
let nextPendingId = 1;
const PENDING_TTL_MS = 120 * 1000;
const PENDING_KEEP_NAMED_MS = 30 * 1000;

function cleanupPending() {
  const now = Date.now();
  for (const [id, p] of pendingObjects) {
    if (p.name && p.named_at && (now - p.named_at) > PENDING_KEEP_NAMED_MS) {
      pendingObjects.delete(id);
    } else if (!p.name && (now - p.created_at) > PENDING_TTL_MS) {
      pendingObjects.delete(id);
    }
  }
}
setInterval(cleanupPending, 5000);

app.post('/api/pending', (req, res) => {
  const L = Number(req.body?.L_mm);
  const W = Number(req.body?.W_mm);
  if (!Number.isFinite(L) || !Number.isFinite(W) || L <= 0 || W <= 0) {
    return res.status(400).json({ success: false, message: 'L_mm dan W_mm harus angka positif.' });
  }
  const id = nextPendingId++;
  pendingObjects.set(id, {
    id,
    L_mm: Number.parseFloat(L.toFixed(3)),
    W_mm: Number.parseFloat(W.toFixed(3)),
    name: null,
    created_at: Date.now(),
    named_at: null,
  });
  console.log(`[PENDING +${id}] L=${L.toFixed(2)} W=${W.toFixed(2)} mm — menunggu nama`);
  res.status(201).json({ success: true, id });
});

app.get('/api/pending', (req, res) => {
  cleanupPending();
  const list = [...pendingObjects.values()]
    .filter(p => !p.name)
    .sort((a, b) => a.id - b.id);
  res.json({ success: true, count: list.length, data: list });
});

app.get('/api/pending/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const p = pendingObjects.get(id);
  if (!p) return res.status(404).json({ success: false, message: 'Pending tidak ditemukan / kadaluarsa.' });
  res.json({ success: true, data: p });
});

app.post('/api/pending/:id/name', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const trimmed = (typeof req.body?.name === 'string') ? req.body.name.trim() : '';
  const p = pendingObjects.get(id);
  if (!p) return res.status(404).json({ success: false, message: 'Pending tidak ditemukan / kadaluarsa.' });
  if (p.name) return res.status(409).json({ success: false, message: 'Pending sudah dinamai sebelumnya.' });
  if (!trimmed) return res.status(400).json({ success: false, message: 'Nama tidak boleh kosong.' });
  if (trimmed.length > 60) return res.status(400).json({ success: false, message: 'Nama maks 60 karakter.' });
  p.name = trimmed;
  p.named_at = Date.now();
  console.log(`[PENDING #${id}] dinamai dari web: "${trimmed}"`);
  res.json({ success: true, data: p });
});

app.delete('/api/pending/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const p = pendingObjects.get(id);
  if (!p) return res.status(404).json({ success: false, message: 'Pending tidak ditemukan.' });
  // Sentinel '__SKIP__' supaya edge poller membedakan skip-via-web dari ada-nama
  p.name = '__SKIP__';
  p.named_at = Date.now();
  console.log(`[PENDING #${id}] dilewati`);
  res.json({ success: true });
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
