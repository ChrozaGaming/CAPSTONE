/**
 * server.js
 * Backend untuk Automated Dimensional Inspection Dashboard
 * Node.js + Express REST API + WebSocket realtime + PostgreSQL mirror
 *
 * Sumber data:
 *   - PRIMARY  : data/inspections.json   (single-file flat, sumber kebenaran)
 *   - MIRROR   : PostgreSQL inspections   (untuk SQL/analytics integrasi)
 *   - REALTIME : WebSocket (ws://host:PORT/ws) — broadcast event ke dashboard
 *
 * Dual-write atomic-ish:
 *   1. POST /inspection → writeData(JSON) → mirrorToPg(entry) → broadcast(WS)
 *   2. Bila PG down: skip mirror, tetap broadcast, JSON tetap konsisten.
 *   3. Bila JSON down: 500 ke client (current behavior).
 *
 * Endpoints:
 *   ── Existing v2.1 ──
 *   POST   /inspection                     — tambah data inspeksi
 *   GET    /inspection                     — ambil semua (dari JSON)
 *   DELETE /inspection                     — hapus semua
 *   POST   /api/pending                    — edge daftarkan objek tak dikenal
 *   GET    /api/pending                    — list pending tanpa nama
 *   GET    /api/pending/:id                — polling status pending
 *   POST   /api/pending/:id/name           — web kirim nama
 *   DELETE /api/pending/:id                — skip pending
 *
 *   ── Baru v2.2 ──
 *   GET    /api/v1/status                  — status PG + WS connection count
 *   GET    /api/v1/inspection              — list (PG bila ada, fallback JSON)
 *   GET    /api/v1/stats/by-object         — agregasi per nama objek
 *   GET    /api/v1/stats/trend             — tren harian
 *   GET    /api/v1/stats/recent            — 100 row terbaru
 *   WS     /ws                             — server push event realtime
 *
 * Hak Cipta: Capstone Topik A3 Kelompok 2, Filkom Universitas Brawijaya.
 */

require('dotenv').config();

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const cors = require('cors');
const { Pool, Client } = require('pg');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const DATA_FILE = path.join(__dirname, 'data', 'inspections.json');

// ── Auth config (Phase 2) — JWT_SECRET shared dengan VPS Next.js ─────
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production-min-32-char-please-rotate';
const VPS_LOGIN_URL = process.env.VPS_LOGIN_URL || 'http://localhost:3001/login';
const ALLOW_DEV_TOKEN = String(process.env.ALLOW_DEV_TOKEN || 'true').toLowerCase() === 'true';
const VALID_ROLES = ['operator', 'supervisor', 'manager'];

if (JWT_SECRET.startsWith('dev-secret-')) {
  console.warn('[AUTH] ⚠ JWT_SECRET pakai default dev — JANGAN dipakai di production. Set di .env');
}

/** Sign JWT dengan claims standar. dipakai oleh dev-token endpoint. */
function signToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn, algorithm: 'HS256' });
}

/** Verify JWT. Return { ok, claims, error }. */
function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'Token kosong / format salah' };
  }
  try {
    const claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return { ok: true, claims };
  } catch (e) {
    return { ok: false, error: e.message || 'Token invalid' };
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ═════════════════════════════════════════════════════════════════════════════
//  FILE PERSISTENCE (JSON — sumber kebenaran)
// ═════════════════════════════════════════════════════════════════════════════
function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readData() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── Internal write lock — cegah feedback loop ────────────────────────
// Setiap kali server.js menulis ke JSON file, set `internalWriteLock`
// supaya file watcher tahu perubahan ini berasal dari server (bukan
// edit manual oleh user). Watcher akan mengabaikan event tsb.
let internalWriteLock = false;
function writeDataInternal(data) {
  internalWriteLock = true;
  writeData(data);
  setTimeout(() => { internalWriteLock = false; }, 600);
}

// ═════════════════════════════════════════════════════════════════════════════
//  POSTGRESQL MIRROR (dengan graceful fallback)
//
//  Bila PG mati / kredensial salah / DB belum ada:
//    pgReady = false → semua mirrorToPg() jadi no-op silently.
//    Server tetap jalan JSON-only.
// ═════════════════════════════════════════════════════════════════════════════
let pgPool = null;
let pgReady = false;

// ═════════════════════════════════════════════════════════════════════════════
//  DB SOURCE SWITCH — local PostgreSQL ↔ cloud (Supabase)
//
//  Mode aktif disimpan ke data/db_mode.json supaya restart inget pilihan
//  terakhir. Default: env DB_MODE → 'local'. Switch runtime via
//  POST /api/db/mode → tear-down pool + listener → rebuild ke target baru.
//
//  CATATAN PENTING (Supabase):
//   - Cloud WAJIB SSL (rejectUnauthorized:false untuk cert pooler).
//   - LISTEN/NOTIFY HANYA jalan di port 5432 (direct / session pooler),
//     TIDAK di 6543 (transaction pooler/pgbouncer). Karena CDC kita pakai
//     LISTEN/NOTIFY, SUPABASE_DB_URL HARUS pakai connection string :5432.
// ═════════════════════════════════════════════════════════════════════════════
const DB_MODE_FILE = path.join(__dirname, 'data', 'db_mode.json');
const VALID_DB_MODES = ['local', 'cloud'];

function readDbMode() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_MODE_FILE, 'utf8'));
    if (VALID_DB_MODES.includes(raw.mode)) return raw.mode;
  } catch { /* file belum ada → pakai env/default */ }
  const envMode = String(process.env.DB_MODE || 'local').toLowerCase();
  return VALID_DB_MODES.includes(envMode) ? envMode : 'local';
}

function writeDbMode(mode) {
  try { fs.writeFileSync(DB_MODE_FILE, JSON.stringify({ mode }, null, 2)); }
  catch (e) { console.warn(`[DB] gagal simpan db_mode.json: ${e.message}`); }
}

let dbMode = readDbMode();
let switching = false;
let dbGeneration = 0;   // naik tiap switch; reconnect in-flight abort kalau berubah

// Connection string Supabase (cloud). Urutan fallback supaya kompatibel
// dengan env yang di-generate Vercel/Supabase integration.
function cloudUrl() {
  // Prioritaskan var yang mendukung LISTEN/NOTIFY (port :5432). DATABASE_URL
  // hasil auto-generate Vercel/Supabase biasanya pooler :6543 (pgbouncer) yang
  // TIDAK mendukung LISTEN/NOTIFY → taruh paling akhir sbg fallback terakhir.
  return process.env.SUPABASE_DB_URL
      || process.env.POSTGRES_URL_NON_POOLING
      || process.env.DATABASE_URL
      || '';
}

// Apakah mode tsb sudah dikonfigurasi (bisa dikonek)?
function isModeAvailable(mode) {
  return mode === 'cloud' ? !!cloudUrl() : !!process.env.PG_PASSWORD;
}

// Config pg untuk mode tertentu — HANYA field valid pg (dipakai Pool & Client).
function pgConfigFor(mode) {
  if (mode === 'cloud') {
    const raw = cloudUrl();
    if (!raw) return null;
    // Buang `sslmode` dari URL supaya tidak bentrok dengan ssl object di bawah.
    // pg versi baru memproses sslmode=require sebagai verify → menolak cert
    // self-signed Supabase pooler. Yang menentukan harus ssl object, bukan query.
    let connectionString = raw;
    try {
      const u = new URL(raw);
      u.searchParams.delete('sslmode');
      connectionString = u.toString();
    } catch { /* URL non-standar → pakai apa adanya */ }
    // ssl object = satu-satunya sumber kebenaran. rejectUnauthorized:false
    // menerima cert chain Supabase (tetap terenkripsi, hanya skip verifikasi CA).
    return { connectionString, ssl: { rejectUnauthorized: false } };
  }
  return {
    host: process.env.PG_HOST || 'localhost',
    port: Number.parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'capstone',
  };
}

// String aman (tanpa password) untuk log & /api status.
function describeTarget(mode) {
  if (mode === 'cloud') {
    const url = cloudUrl();
    if (!url) return 'cloud (SUPABASE_DB_URL belum di-set)';
    try {
      const u = new URL(url);
      return `${u.username}@${u.hostname}:${u.port || '5432'}${u.pathname}`;
    } catch { return 'cloud (Supabase)'; }
  }
  const u = process.env.PG_USER || 'postgres';
  const h = process.env.PG_HOST || 'localhost';
  const p = process.env.PG_PORT || '5432';
  const d = process.env.PG_DATABASE || 'capstone';
  return `${u}@${h}:${p}/${d}`;
}

// Status DB ringkas — dipakai endpoint, WS hello, & broadcast. Tanpa secret.
function dbStatus() {
  return {
    mode: dbMode,
    pgReady,
    target: describeTarget(dbMode),
    available: { local: isModeAvailable('local'), cloud: isModeAvailable('cloud') },
  };
}

// Switch sumber DB at runtime: tear-down pool + listener → rebuild ke mode baru.
// Idempotent kalau mode sama & sudah konek. Dilindungi flag `switching` supaya
// tidak ada dua switch overlap.
// Peringatan keras kalau cloud konek via pooler :6543 (pgbouncer transaction
// mode): connect & SELECT 1 sukses, tapi LISTEN/NOTIFY (CDC) diam-diam mati.
function warnIfCloudTransactionPooler() {
  if (dbMode !== 'cloud') return;
  try {
    if (new URL(cloudUrl()).port === '6543') {
      console.warn('[PG] ⚠ Cloud pakai port :6543 (transaction pooler) — LISTEN/NOTIFY TIDAK jalan! Ganti SUPABASE_DB_URL ke session pooler :5432.');
    }
  } catch { /* URL non-standar → skip */ }
}

async function switchDatabase(mode) {
  mode = VALID_DB_MODES.includes(mode) ? mode : 'local';
  if (switching) throw new Error('Sedang memproses switch DB lain — coba lagi sebentar');
  if (mode === dbMode && pgReady) return { ok: true, requested: mode, ...dbStatus() };

  switching = true;
  dbGeneration++;                 // invalidasi reconnect timer yang mungkin in-flight
  const prevMode = dbMode;
  try {
    console.log(`[DB] Switching ${prevMode} → ${mode}…`);
    // 1. Batalkan reconnect timer yang mungkin pending (hindari listener dobel)
    if (listenReconnectTimer) { clearTimeout(listenReconnectTimer); listenReconnectTimer = null; }
    // 2. Tutup listener client lama — lepas handler dulu supaya event 'end'/'error'
    //    tidak memicu tryReconnectListener (yang bakal adu balap dgn rebuild).
    try {
      if (listenClient) { listenClient.removeAllListeners(); await listenClient.end(); }
    } catch { /* ignore */ }
    listenClient = null;
    // 3. Tutup pool lama
    try { if (pgPool) await pgPool.end(); } catch { /* ignore */ }
    pgPool = null;
    pgReady = false;

    // 4. Coba konek ke mode baru
    dbMode = mode;
    await initPostgres();
    if (pgReady) {
      await setupPgListener();
      writeDbMode(mode);                  // persist HANYA kalau berhasil konek
      console.log(`[DB] Aktif: ${dbMode} (pgReady=true)`);
      broadcast('db.mode_changed', dbStatus());
      return { ok: true, requested: mode, ...dbStatus() };
    }

    // 5. GAGAL → rollback ke mode sebelumnya supaya koneksi kerja tidak hilang
    console.warn(`[DB] '${mode}' gagal konek — rollback ke '${prevMode}'`);
    if (prevMode !== mode) {
      dbMode = prevMode;
      await initPostgres();
      if (pgReady) await setupPgListener();
    }
    broadcast('db.mode_changed', dbStatus());
    return { ok: false, requested: mode, ...dbStatus() };
  } finally {
    switching = false;
    // Self-heal: pasang reconnect timer kalau (a) pool gagal/rollback gagal
    // (pgReady false), ATAU (b) pool OK tapi listener-nya yang gagal (pgReady
    // true tapi listenClient null) — keduanya bikin CDC mati & butuh recovery.
    // tryReconnectListener bail kalau switching, makanya dipanggil SETELAH
    // switching=false di atas.
    if ((!pgReady || !listenClient) && !listenReconnectTimer) tryReconnectListener();
  }
}

async function initPostgres() {
  const cfg = pgConfigFor(dbMode);

  if (!cfg) {
    console.warn(`[PG] mode '${dbMode}' tapi SUPABASE_DB_URL kosong — server JSON-only`);
    return;
  }
  if (!cfg.connectionString && !cfg.password) {
    console.warn('[PG] PG_PASSWORD kosong — server tetap jalan JSON-only');
    return;
  }

  // Bangun pool di variabel LOKAL dulu; commit ke global pgPool HANYA setelah
  // ping sukses DAN generation masih sama. Kalau ada switch/rebuild lain yang
  // start saat kita lagi await, kita batalkan diam-diam tanpa meng-clobber pool
  // global yang lebih baru (mencegah race: stale init mennull-kan pool sehat).
  const myGen = dbGeneration;
  let p = null;
  try {
    p = new Pool({
      ...cfg,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // Ping
    await p.query('SELECT 1');
    if (myGen !== dbGeneration) { await p.end().catch(() => {}); return; }  // switch ambil alih

    pgPool = p;                 // commit ke global
    pgReady = true;
    console.log(`[PG] Connected ✓ [${dbMode}] — ${describeTarget(dbMode)}`);
    warnIfCloudTransactionPooler();

    // Auto-migrasi JSON → PG saat tabel kosong tapi JSON sudah punya data.
    // Query pakai `p` (pool kita), bukan global, supaya tetap benar walau global
    // sempat berubah. Idempotent (ON CONFLICT DO UPDATE) jadi aman re-run.
    try {
      const r = await p.query('SELECT COUNT(*)::int AS n FROM inspections');
      if (myGen !== dbGeneration) return;   // switch ambil alih → jangan sentuh global/migrasi
      if (r.rows[0].n === 0) {
        const jsonRows = readData();
        if (jsonRows.length > 0) {
          console.log(`[PG] Tabel kosong — migrating ${jsonRows.length} row dari JSON…`);
          let ok = 0, fail = 0;
          for (const row of jsonRows) {
            try { await mirrorToPg(row); ok++; } catch (e) { fail++; console.warn(`[PG] skip #${row.id}: ${e.message}`); }
          }
          console.log(`[PG] Migrasi selesai: ${ok} ok, ${fail} fail`);
        }
      }
    } catch (e) {
      console.warn(`[PG] Skema 'inspections' belum dibuat? Run db/schema.sql dulu. (${e.message})`);
      // Pool kita sudah terbuka tapi skema tidak ada → tutup pool KITA. Hanya
      // null-kan global kalau global masih milik kita (gen cocok).
      await p.end().catch(() => {});
      if (myGen === dbGeneration) { pgPool = null; pgReady = false; }
    }
  } catch (e) {
    console.warn(`[PG] Disabled — ${e.message}. Server tetap jalan JSON-only.`);
    if (p) await p.end().catch(() => {});
    if (myGen === dbGeneration) { pgPool = null; pgReady = false; }
  }
}

// Translate legacy values (OK/NG) ke storage canonical (GOOD/NOT GOOD).
// Idempotent: nilai canonical dilewatkan apa adanya. Defense-in-depth saat
// JSON ditulis manual oleh user dengan label legacy.
function normalizeStatus(s) {
  if (s === 'OK')   return 'GOOD';
  if (s === 'NG')   return 'NOT GOOD';
  return s;
}

async function mirrorToPg(entry) {
  if (!pgReady || !pgPool) return;
  await pgPool.query(
    `INSERT INTO inspections
       (id, object_name, dimension_mm, width_mm, confidence, status, "timestamp")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       object_name  = EXCLUDED.object_name,
       dimension_mm = EXCLUDED.dimension_mm,
       width_mm     = EXCLUDED.width_mm,
       confidence   = EXCLUDED.confidence,
       status       = EXCLUDED.status,
       "timestamp"  = EXCLUDED."timestamp"`,
    [
      entry.id,
      entry.object_name,
      entry.dimension_mm,
      entry.width_mm,
      entry.confidence,
      normalizeStatus(entry.status),
      entry.timestamp,
    ],
  );
}

async function clearPg() {
  if (!pgReady || !pgPool) return;
  await pgPool.query('TRUNCATE TABLE inspections');
}

// ═════════════════════════════════════════════════════════════════════════════
//  CDC LISTENER — PG → JSON sync via LISTEN/NOTIFY
//
//  Trigger di db/triggers.sql memicu pg_notify('inspection_change', payload)
//  pada setiap INSERT/UPDATE/DELETE/TRUNCATE. Listener client dedikasi
//  (BUKAN dari pool, karena pool connection bisa dipinjam-pakai) subscribe
//  ke channel tersebut dan menyinkronkan perubahan ke JSON file + broadcast WS.
// ═════════════════════════════════════════════════════════════════════════════
let listenClient = null;
let listenReconnectTimer = null;

async function setupPgListener() {
  if (!pgReady) return;
  // Pakai Client dedikasi karena LISTEN connection harus persistent
  // (pool connection bisa dilepas dan re-assign ke query lain).
  // Ikut mode aktif (local/cloud) + SSL kalau cloud. LISTEN/NOTIFY hanya
  // jalan di port 5432 — pastikan SUPABASE_DB_URL bukan pooler :6543.
  const cfg = pgConfigFor(dbMode);
  if (!cfg) return;
  // Bangun Client di variabel LOKAL; commit ke global listenClient HANYA setelah
  // connect+LISTEN sukses DAN generation masih sama (mencegah duplikat listener /
  // orphan connection saat switch jalan di tengah connect()).
  const myGen = dbGeneration;
  let client = null;
  try {
    client = new Client(cfg);
    await client.connect();
    await client.query('LISTEN inspection_change');
    if (myGen !== dbGeneration) { await client.end().catch(() => {}); return; }  // switch ambil alih

    listenClient = client;       // commit ke global
    listenClient.on('notification', onPgNotification);
    listenClient.on('error', (e) => {
      console.warn(`[LISTEN] disconnected: ${e.message}`);
      pgReady = false;
      tryReconnectListener();
    });
    listenClient.on('end', () => {
      console.warn('[LISTEN] connection ended');
      tryReconnectListener();
    });
    console.log('[LISTEN] subscribed to channel "inspection_change"');
  } catch (e) {
    console.warn(`[LISTEN] setup gagal: ${e.message}`);
    if (client) await client.end().catch(() => {});
    if (myGen === dbGeneration) { listenClient = null; tryReconnectListener(); }
  }
}

function tryReconnectListener() {
  if (switching) return;          // jangan adu balap dgn switchDatabase yg lagi rebuild
  if (listenReconnectTimer) return;
  const gen = dbGeneration;       // snapshot — kalau switch jalan, gen berubah → abort
  listenReconnectTimer = setTimeout(async () => {
    listenReconnectTimer = null;
    // Abort kalau ada switch (sedang/sudah) — switchDatabase yang pegang rebuild.
    // Dicek ulang setelah TIAP await karena callback bisa yield di tengah jalan.
    if (switching || gen !== dbGeneration) return;
    console.log('[LISTEN] retry…');
    try { if (listenClient) { listenClient.removeAllListeners(); await listenClient.end(); } } catch { /* */ }
    listenClient = null;
    if (switching || gen !== dbGeneration) return;
    // Re-init PG connection juga (mungkin server PG mati)
    await initPostgres();
    if (switching || gen !== dbGeneration) return;  // switch ambil alih saat init → biar dia yang urus
    if (pgReady) {
      await setupPgListener();
      await catchUpPendingJsonToPg(); // sync data offline ke PG begitu reconnect
    } else {
      tryReconnectListener();
    }
  }, 5000);
}

function onPgNotification(msg) {
  if (msg.channel !== 'inspection_change') return;
  let payload;
  try { payload = JSON.parse(msg.payload); }
  catch (e) { console.warn(`[LISTEN] bad JSON: ${e.message}`); return; }
  applyPgChangeToJson(payload).catch(e =>
    console.warn(`[LISTEN] apply failed: ${e.message}`));
}

/**
 * Replikasikan perubahan PG ke JSON file + broadcast WS.
 * Dipanggil dari listener saat NOTIFY masuk.
 */
async function applyPgChangeToJson(payload) {
  const { op, id, data } = payload;
  let json = readData();

  if (op === 'INSERT' || op === 'UPDATE') {
    // Normalize timestamp ke ISO string supaya konsisten dengan JSON existing
    const row = normalizeRow(data);
    const idx = json.findIndex(r => r.id === id);
    if (idx >= 0) json[idx] = row;
    else json.push(row);
    writeDataInternal(json);
    broadcast(op === 'INSERT' ? 'inspection.created' : 'inspection.updated', row);
    console.log(`[SYNC] PG→JSON ${op} #${id}`);
  } else if (op === 'DELETE') {
    const before = json.length;
    json = json.filter(r => r.id !== id);
    if (json.length !== before) {
      writeDataInternal(json);
      broadcast('inspection.deleted', { id });
      console.log(`[SYNC] PG→JSON DELETE #${id}`);
    }
  } else if (op === 'TRUNCATE') {
    writeDataInternal([]);
    broadcast('inspection.cleared', {});
    console.log('[SYNC] PG→JSON TRUNCATE');
  }
}

function normalizeRow(row) {
  const ts = row.timestamp;
  return {
    id:           row.id,
    object_name:  row.object_name,
    dimension_mm: row.dimension_mm !== null ? Number(row.dimension_mm) : null,
    width_mm:     row.width_mm     !== null ? Number(row.width_mm)     : null,
    confidence:   row.confidence   !== null ? Number(row.confidence)   : null,
    status:       row.status,
    timestamp:    typeof ts === 'string' ? ts : new Date(ts).toISOString(),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  CATCH-UP SYNC — saat PG reconnect, push pending JSON rows yang belum di PG
// ═════════════════════════════════════════════════════════════════════════════
async function catchUpPendingJsonToPg() {
  if (!pgReady) return;
  try {
    const r = await pgPool.query('SELECT id FROM inspections');
    const pgIds = new Set(r.rows.map(x => Number(x.id)));
    const json = readData();
    const missing = json.filter(r => !pgIds.has(r.id));
    if (missing.length === 0) {
      console.log('[CATCHUP] JSON ↔ PG sudah konsisten');
      return;
    }
    console.log(`[CATCHUP] push ${missing.length} row JSON → PG…`);
    let ok = 0, fail = 0;
    for (const row of missing) {
      try { await mirrorToPg(row); ok++; } catch (e) { fail++; console.warn(`[CATCHUP] #${row.id}: ${e.message}`); }
    }
    console.log(`[CATCHUP] selesai: ${ok} ok, ${fail} fail`);
  } catch (e) {
    console.warn(`[CATCHUP] gagal: ${e.message}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE WATCHER — JSON → PG sync
//
//  Saat user edit JSON manual (mis. hapus row dari editor), watcher detect
//  perubahan + diff dengan PG → push delta. Internal write lock cegah
//  watcher fire saat server.js sendiri yang nulis (writeDataInternal).
// ═════════════════════════════════════════════════════════════════════════════
let fileWatcher = null;
let watcherDebounceTimer = null;

function setupJsonWatcher() {
  if (fileWatcher) return;
  fileWatcher = chokidar.watch(DATA_FILE, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
  });
  fileWatcher.on('change', () => {
    if (internalWriteLock) return;  // perubahan dari server, abaikan
    clearTimeout(watcherDebounceTimer);
    watcherDebounceTimer = setTimeout(reconcileJsonToPg, 200);
  });
  fileWatcher.on('error', (e) => console.warn(`[WATCH] error: ${e.message}`));
  console.log(`[WATCH] memantau ${DATA_FILE}`);
}

async function reconcileJsonToPg() {
  if (!pgReady) {
    console.log('[RECONCILE] PG offline — skip JSON→PG sync');
    return;
  }

  // STRICT parse dengan handling khusus untuk "user clear seluruh isi file":
  //   - File 0 bytes / hanya whitespace → INTENTIONAL WIPE-ALL.
  //     Restore file ke canonical '[]' (supaya parse berikutnya gak error)
  //     dan biarkan reconcile lanjut dengan json=[] → triggers TRUNCATE PG.
  //   - File ada isinya tapi parse gagal (sintaks rusak/setengah tertulis) →
  //     skip reconcile (PG dipertahankan, jangan dirusak).
  //
  //  chokidar awaitWriteFinish (stabilityThreshold 250ms) mencegah false-fire
  //  saat editor pakai atomic-save (truncate → rename) — yang sampai ke kita
  //  hanya state stabil ≥250ms.
  let json;
  try {
    const text = fs.readFileSync(DATA_FILE, 'utf8').trim();
    if (text === '') {
      // User clear seluruh isi file (Cmd+A → Delete + Save) → wipe intent.
      console.log('[RECONCILE] JSON file dikosongkan total — interpret sebagai wipe-all');
      writeDataInternal([]); // restore ke '[]' supaya format file tetap valid
      json = [];
    } else {
      json = JSON.parse(text);
      if (!Array.isArray(json)) throw new Error('JSON root harus array');
    }
  } catch (e) {
    console.warn(`[RECONCILE] JSON parse error: ${e.message} — skip (PG dipertahankan)`);
    return;
  }

  try {
    const r = await pgPool.query('SELECT id FROM inspections');
    const pgIds = new Set(r.rows.map(x => Number(x.id)));
    const jsonIds = new Set(json.map(x => Number(x.id)));

    let inserts = 0, deletes = 0;

    // Row di JSON tapi tidak di PG → INSERT
    for (const row of json) {
      if (!pgIds.has(Number(row.id))) {
        try { await mirrorToPg(row); inserts++; } catch (e) { console.warn(`[RECONCILE] insert #${row.id}: ${e.message}`); }
      }
    }

    // Optimasi: kalau JSON sengaja dikosongkan total → TRUNCATE (1 query, 1 NOTIFY).
    // Auto-increment otomatis reset karena MAX(id) → NULL → COALESCE → 0 → next id = 1.
    if (json.length === 0 && pgIds.size > 0) {
      console.log(`[RECONCILE] JSON kosong total → TRUNCATE PG (${pgIds.size} row dihapus, auto-increment reset ke 1)`);
      await pgPool.query('TRUNCATE TABLE inspections');
      deletes = pgIds.size;
    } else {
      // Row di PG tapi tidak di JSON → DELETE per row
      for (const pgId of pgIds) {
        if (!jsonIds.has(pgId)) {
          try {
            await pgPool.query('DELETE FROM inspections WHERE id=$1', [pgId]);
            deletes++;
          } catch (e) { console.warn(`[RECONCILE] delete #${pgId}: ${e.message}`); }
        }
      }
    }
    if (inserts || deletes) {
      console.log(`[RECONCILE] JSON→PG: +${inserts} insert, -${deletes} delete`);
    }
  } catch (e) {
    console.warn(`[RECONCILE] gagal: ${e.message}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  WEBSOCKET BROADCAST
//
//  Setiap state change → server broadcast {type, data} ke semua client.
//  Dashboard subscribe sekali, update real-time tanpa polling.
// ═════════════════════════════════════════════════════════════════════════════
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Client connected from ${ip} (total: ${wss.clients.size})`);
  ws.send(JSON.stringify({ type: 'hello', data: { ...dbStatus(), time: new Date().toISOString() } }));

  ws.on('close', () => {
    console.log(`[WS] Client disconnected (total: ${wss.clients.size})`);
  });

  ws.on('error', (err) => {
    console.warn(`[WS] Error: ${err.message}`);
  });
});

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, t: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      try { client.send(msg); } catch { /* ignore */ }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — INSPECTION (existing v2.1, dengan dual-write + broadcast)
// ═════════════════════════════════════════════════════════════════════════════

// PG-backed read kalau PG ready (canonical source of truth) — fallback ke JSON
// kalau PG offline. Begitu external service INSERT/DELETE/TRUNCATE via psql,
// dashboard otomatis lihat perubahan setelah refresh / WS event.
app.get('/inspection', async (_req, res) => {
  if (pgReady) {
    try {
      const r = await pgPool.query(
        `SELECT id, object_name, dimension_mm, width_mm, confidence, status, "timestamp"
         FROM inspections ORDER BY id DESC`);
      const rows = r.rows.map(normalizeRow);
      return res.json({ success: true, source: 'postgres', count: rows.length, data: rows });
    } catch (e) {
      console.warn(`[GET /inspection] PG fallback to JSON: ${e.message}`);
    }
  }
  const data = readData().sort((a, b) => b.id - a.id);
  res.json({ success: true, source: 'json', count: data.length, data });
});

app.post('/inspection', async (req, res) => {
  const { dimension_mm, width_mm, status: rawStatus, confidence, object_name } = req.body;

  if (dimension_mm === undefined || dimension_mm === null) {
    return res.status(400).json({ success: false, message: 'dimension_mm wajib diisi.' });
  }

  // Translate legacy values dari edge_camera.py (OK/NG) ke storage (GOOD/NOT GOOD).
  // edge_camera.py tidak boleh disentuh, jadi server yang melakukan translation di boundary.
  // Tetap menerima nilai baru juga supaya client web bisa POST 'GOOD'/'NOT GOOD' langsung.
  const STATUS_MAP = { OK: 'GOOD', NG: 'NOT GOOD', GOOD: 'GOOD', 'NOT GOOD': 'NOT GOOD' };
  const status = STATUS_MAP[rawStatus];
  if (!status) {
    return res.status(400).json({ success: false, message: 'status harus "GOOD" atau "NOT GOOD" (legacy "OK"/"NG" juga diterima).' });
  }

  const cleanName = (typeof object_name === 'string' && object_name.trim()) ? object_name.trim() : null;
  const cleanDim  = Number.parseFloat(Number(dimension_mm).toFixed(3));
  const cleanW    = (width_mm !== undefined && width_mm !== null) ? Number.parseFloat(Number(width_mm).toFixed(3)) : null;
  const cleanConf = (confidence !== undefined && confidence !== null) ? Number(confidence) : null;

  // PATH A: PG ready → INSERT ke PG, biar PG yang assign id (max+1).
  // Trigger akan fire NOTIFY → listener replicate ke JSON + broadcast WS.
  // Server tetap broadcast langsung untuk fast-path (idempotent fetchAndRender di client).
  if (pgReady) {
    try {
      const r = await pgPool.query(
        `INSERT INTO inspections
           (id, object_name, dimension_mm, width_mm, confidence, status, "timestamp")
         VALUES (
           (SELECT COALESCE(MAX(id), 0) + 1 FROM inspections),
           $1, $2, $3, $4, $5, NOW()
         )
         RETURNING id, object_name, dimension_mm, width_mm, confidence, status, "timestamp"`,
        [cleanName, cleanDim, cleanW, cleanConf, status],
      );
      const newEntry = normalizeRow(r.rows[0]);
      // JSON akan di-sync oleh listener (PG → JSON via NOTIFY).
      broadcast('inspection.created', newEntry);
      const tag = newEntry.object_name ? `[${newEntry.object_name}] ` : '';
      console.log(`[+] Inspeksi #${newEntry.id} ${tag}| L=${cleanDim} W=${cleanW ?? '—'} mm | ${status} (via PG)`);
      return res.status(201).json({ success: true, source: 'postgres', data: newEntry });
    } catch (e) {
      console.warn(`[POST /inspection] PG insert gagal, fallback JSON: ${e.message}`);
    }
  }

  // PATH B: PG offline → tulis ke JSON saja, tandai pending_sync untuk catch-up nanti.
  const data = readData();
  const newId = data.length > 0 ? Math.max(...data.map(d => d.id)) + 1 : 1;
  const newEntry = {
    id: newId,
    object_name: cleanName,
    dimension_mm: cleanDim,
    width_mm: cleanW,
    confidence: cleanConf,
    status,
    timestamp: new Date().toISOString(),
    pending_sync: true,
  };
  data.push(newEntry);
  writeDataInternal(data);
  broadcast('inspection.created', newEntry);
  const tag = newEntry.object_name ? `[${newEntry.object_name}] ` : '';
  console.log(`[+] Inspeksi #${newId} ${tag}| L=${cleanDim} W=${cleanW ?? '—'} mm | ${status} (JSON-only, pending sync)`);
  res.status(201).json({ success: true, source: 'json', fallback: true, data: newEntry });
});

// DELETE single row by id — PG kalau ada, JSON kalau PG offline.
app.delete('/inspection/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, message: 'id harus angka' });
  }
  if (pgReady) {
    try {
      const r = await pgPool.query('DELETE FROM inspections WHERE id=$1', [id]);
      // Trigger NOTIFY akan handle JSON sync. Broadcast langsung untuk UX cepat.
      broadcast('inspection.deleted', { id });
      return res.json({ success: true, source: 'postgres', deleted: r.rowCount });
    } catch (e) {
      console.warn(`[DELETE /inspection/:id] PG fallback: ${e.message}`);
    }
  }
  const data = readData();
  const filtered = data.filter(r => r.id !== id);
  writeDataInternal(filtered);
  broadcast('inspection.deleted', { id });
  res.json({ success: true, source: 'json', deleted: data.length - filtered.length });
});

app.delete('/inspection', async (_req, res) => {
  // PG TRUNCATE → trigger fire 'TRUNCATE' notification → listener kosongkan JSON.
  if (pgReady) {
    try {
      await pgPool.query('TRUNCATE TABLE inspections');
      broadcast('inspection.cleared', {});
      console.log('[!] Semua data inspeksi dihapus (PG TRUNCATE).');
      return res.json({ success: true, source: 'postgres', message: 'Semua data berhasil dihapus.' });
    } catch (e) {
      console.warn(`[DELETE /inspection] PG fallback: ${e.message}`);
    }
  }
  writeDataInternal([]);
  broadcast('inspection.cleared', {});
  console.log('[!] Semua data inspeksi dihapus (JSON-only).');
  res.json({ success: true, source: 'json', message: 'Semua data berhasil dihapus.' });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — AUTH (Phase 2): JWT verify untuk konsumsi token dari VPS Next.js
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/auth/config — return auth-related config untuk frontend.
 * Dipakai oleh script.js untuk redirect ke VPS login saat token invalid.
 */
app.get('/api/auth/config', (_req, res) => {
  res.json({
    success: true,
    data: {
      vps_login_url: VPS_LOGIN_URL,
      allow_dev_token: ALLOW_DEV_TOKEN,
      valid_roles: VALID_ROLES,
    },
  });
});

/**
 * POST /api/auth/verify — terima { token }, validate signature & expiry.
 * Return claims (user info + role) untuk frontend gating.
 *
 * Body: { token: string }
 * Response 200: { success: true, data: { user: {...}, expiresAt } }
 * Response 401: { success: false, message: '...' }
 */
app.post('/api/auth/verify', (req, res) => {
  const token = req.body?.token;
  const result = verifyToken(token);
  if (!result.ok) {
    return res.status(401).json({ success: false, message: result.error });
  }
  const claims = result.claims;
  // Validate role (defense-in-depth)
  if (!VALID_ROLES.includes(claims.role)) {
    return res.status(401).json({
      success: false,
      message: `Role '${claims.role}' tidak valid. Harus: ${VALID_ROLES.join(', ')}`,
    });
  }
  res.json({
    success: true,
    data: {
      user: {
        id: claims.sub || claims.id || null,
        email: claims.email || null,
        name: claims.name || claims.email || 'User',
        role: claims.role,
      },
      expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
      issuedAt: claims.iat ? new Date(claims.iat * 1000).toISOString() : null,
    },
  });
});

/**
 * GET /api/auth/dev-token?role=operator&name=Demo
 * — Issue token sample untuk testing Phase 2 tanpa Next.js berjalan.
 * Hanya aktif kalau ALLOW_DEV_TOKEN=true di .env. Disable di production.
 */
app.get('/api/auth/dev-token', (req, res) => {
  if (!ALLOW_DEV_TOKEN) {
    return res.status(403).json({
      success: false,
      message: 'Dev token disabled — set ALLOW_DEV_TOKEN=true di .env',
    });
  }
  const role = String(req.query.role || 'operator').toLowerCase();
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({
      success: false,
      message: `Role harus salah satu: ${VALID_ROLES.join(', ')}`,
    });
  }
  const name = String(req.query.name || `Demo ${role}`);
  const email = String(req.query.email || `${role}@capstone.dev`);
  const token = signToken({
    sub: `dev-${role}`,
    email,
    name,
    role,
  }, '24h');
  res.json({
    success: true,
    data: {
      token,
      role,
      name,
      email,
      hint: `Buka http://localhost:${PORT}/?token=${token} untuk login otomatis`,
    },
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — PENDING NAMING (existing v2.1, dengan broadcast)
// ═════════════════════════════════════════════════════════════════════════════

const pendingObjects = new Map();
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
  const entry = {
    id,
    L_mm: Number.parseFloat(L.toFixed(3)),
    W_mm: Number.parseFloat(W.toFixed(3)),
    name: null,
    created_at: Date.now(),
    named_at: null,
  };
  pendingObjects.set(id, entry);
  broadcast('pending.created', entry);
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
  broadcast('pending.named', { id, name: trimmed });
  console.log(`[PENDING #${id}] dinamai dari web: "${trimmed}"`);
  res.json({ success: true, data: p });
});

app.delete('/api/pending/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const p = pendingObjects.get(id);
  if (!p) return res.status(404).json({ success: false, message: 'Pending tidak ditemukan.' });
  p.name = '__SKIP__';
  p.named_at = Date.now();
  broadcast('pending.cancelled', { id });
  console.log(`[PENDING #${id}] dilewati`);
  res.json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — API V1 (analytics & status, baru di v2.2)
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/v1/status', (req, res) => {
  res.json({
    success: true,
    pg: {
      connected: pgReady,
      mode: dbMode,
      target: describeTarget(dbMode),
    },
    db: dbStatus(),
    ws: {
      clients: wss.clients.size,
    },
    json: {
      rows: readData().length,
    },
  });
});

// ── DB SOURCE SWITCH ──────────────────────────────────────────────────
// GET  /api/db/mode  → status mode aktif + ketersediaan tiap mode
// POST /api/db/mode  { "mode": "local" | "cloud" } → switch runtime
app.get('/api/db/mode', (_req, res) => {
  res.json({ success: true, ...dbStatus() });
});

app.post('/api/db/mode', async (req, res) => {
  const mode = String(req.body?.mode || '').toLowerCase();
  if (!VALID_DB_MODES.includes(mode)) {
    return res.status(400).json({ success: false, message: "mode harus 'local' atau 'cloud'" });
  }
  if (!isModeAvailable(mode)) {
    return res.status(400).json({
      success: false,
      message: mode === 'cloud'
        ? 'Mode cloud belum dikonfigurasi — set SUPABASE_DB_URL di .env'
        : 'Mode local belum dikonfigurasi — set PG_PASSWORD di .env',
      ...dbStatus(),
    });
  }
  try {
    const st = await switchDatabase(mode);
    if (st.ok) return res.json({ success: true, ...st });
    return res.status(502).json({
      success: false,
      message: st.pgReady
        ? `Gagal konek ke '${st.requested}' — tetap pakai '${st.mode}'. Cek kredensial / skema DB.`
        : `Gagal konek ke '${st.requested}' — server JSON-only. Cek kredensial / skema DB.`,
      ...st,
    });
  } catch (e) {
    res.status(409).json({ success: false, message: e.message, ...dbStatus() });
  }
});

app.get('/api/v1/inspection', async (req, res) => {
  // Bila PG ready, baca dari PG (lebih cepat untuk volume besar + filter SQL).
  // Bila tidak, fallback ke JSON.
  const limit = Math.min(Number.parseInt(req.query.limit || '500', 10), 5000);
  if (pgReady) {
    try {
      const r = await pgPool.query(
        `SELECT id, object_name, dimension_mm, width_mm, confidence, status, "timestamp"
         FROM inspections ORDER BY "timestamp" DESC LIMIT $1`,
        [limit],
      );
      return res.json({ success: true, source: 'postgres', count: r.rows.length, data: r.rows });
    } catch (e) {
      console.warn(`[PG] /api/v1/inspection fallback to JSON: ${e.message}`);
    }
  }
  const data = readData().sort((a, b) => b.id - a.id).slice(0, limit);
  res.json({ success: true, source: 'json', count: data.length, data });
});

app.get('/api/v1/stats/by-object', async (req, res) => {
  if (!pgReady) {
    return res.status(503).json({
      success: false,
      message: 'PostgreSQL tidak terhubung — analytics endpoint butuh PG. Cek koneksi.',
    });
  }
  try {
    const r = await pgPool.query('SELECT * FROM v_inspection_summary');
    res.json({ success: true, count: r.rows.length, data: r.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/v1/stats/trend', async (req, res) => {
  if (!pgReady) {
    return res.status(503).json({ success: false, message: 'PostgreSQL tidak terhubung.' });
  }
  try {
    const r = await pgPool.query('SELECT * FROM v_inspection_daily_trend LIMIT 30');
    res.json({ success: true, count: r.rows.length, data: r.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/v1/stats/recent', async (req, res) => {
  if (!pgReady) {
    const data = readData().sort((a, b) => b.id - a.id).slice(0, 100);
    return res.json({ success: true, source: 'json', count: data.length, data });
  }
  try {
    const r = await pgPool.query('SELECT * FROM v_inspection_recent');
    res.json({ success: true, source: 'postgres', count: r.rows.length, data: r.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  ROOT
// ═════════════════════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ═════════════════════════════════════════════════════════════════════════════
//  STARTUP
// ═════════════════════════════════════════════════════════════════════════════
async function start() {
  await initPostgres();

  // CDC pipeline: PG triggers → LISTEN/NOTIFY → server replicate ke JSON + WS.
  if (pgReady) {
    await setupPgListener();
    await catchUpPendingJsonToPg();
  } else {
    // Coba reconnect periodik kalau PG awal-awal mati.
    tryReconnectListener();
  }

  // Watcher: JSON edit manual → reconcile ke PG.
  setupJsonWatcher();

  httpServer.listen(PORT, () => {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║   Automated Dimensional Inspection — Backend v2.3    ║');
    console.log('║   Hybrid CDC sync: PG ↔ JSON ↔ WebSocket             ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║   HTTP   : http://localhost:${PORT}`.padEnd(55) + '║');
    console.log(`║   WS     : ws://localhost:${PORT}/ws`.padEnd(55) + '║');
    console.log(`║   JSON   : ${DATA_FILE}`.padEnd(55) + '║');
    console.log(`║   PG     : ${pgReady ? '✓ connected + LISTEN active' : '✗ disconnected (JSON-only fallback)'}`.padEnd(55) + '║');
    console.log('╚══════════════════════════════════════════════════════╝');
  });
}

// ── Graceful shutdown (responsive) ────────────────────────────────────
//
// Tanpa terminate eksplisit, httpServer.close() menunggu SEMUA koneksi
// keep-alive HTTP & WebSocket benar-benar tutup → kalau dashboard browser
// masih open atau ada poller pending, callback tidak pernah firing → stuck.
//
// Strategi:
//   1. Force-terminate semua WS client (kirim close frame agresif).
//   2. Tutup pg pool.
//   3. Stop terima koneksi baru via httpServer.close().
//   4. Hard timeout 1.5s — kalau masih ada socket hang, force exit.
//   5. Handler idempotent — Ctrl-C kedua langsung exit(1) tanpa nunggu.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) {
    console.log(`\n[!] ${signal} again — force exit`);
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`\n[!] ${signal} received — shutting down…`);

  // 1. Force-close semua WebSocket client
  for (const client of wss.clients) {
    try { client.terminate(); } catch { /* ignore */ }
  }
  try { wss.close(); } catch { /* ignore */ }

  // 2. Hard timeout fallback — pasti exit dalam 1.5s
  const forceTimer = setTimeout(() => {
    console.warn('[!] Force exit after 1.5s timeout');
    process.exit(1);
  }, 1500);
  forceTimer.unref();

  // 3. Tutup HTTP server (tidak blocking ke timeout)
  httpServer.close(async () => {
    if (fileWatcher) {
      try { await fileWatcher.close(); } catch { /* ignore */ }
    }
    if (listenClient) {
      try { await listenClient.end(); } catch { /* ignore */ }
    }
    if (pgPool) {
      try { await pgPool.end(); } catch { /* ignore */ }
    }
    clearTimeout(forceTimer);
    console.log('[✓] Bye');
    process.exit(0);
  });

  // 4. Drop semua active socket koneksi keep-alive segera
  if (typeof httpServer.closeAllConnections === 'function') {
    httpServer.closeAllConnections();
  }
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch(e => {
  console.error('[FATAL] Startup failed:', e);
  process.exit(1);
});
