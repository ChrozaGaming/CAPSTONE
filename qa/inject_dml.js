#!/usr/bin/env node
/**
 * qa/inject_dml.js
 *
 * Inject 15 DML rows ke PostgreSQL `inspections` dengan jeda 5 detik
 * tiap row, jenis barang variatif. Simulasi external service (BI/ETL/admin)
 * yang nulis langsung ke PG, bukan via REST.
 *
 * Run: node qa/inject_dml.js
 *
 * Catatan:
 *   - Direct DML → muncul di /api/v1/inspection (PG-backed) + view analytics
 *   - Direct DML → TIDAK muncul di /inspection (JSON-backed, dashboard utama)
 *     Ini behavior by-design Level 2 architecture (lihat docs / TC-E03).
 *   - Untuk sync ke JSON juga, pakai REST POST /inspection (lihat fungsi
 *     `usePostMode` di bawah — ganti ke `true` kalau mau dual-write).
 */

'use strict';
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const { Pool } = require('pg');

const usePostMode = false;  // true = REST POST (sync JSON+PG), false = direct DML PG

const pgPool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number.parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'capstone',
});

// ── Sample data (15 jenis variatif) ──────────────────────────────────
const SAMPLES = [
  { name: 'KTP',                 L:  85.62, W:  53.98, status: 'OK', conf: 0.96 },
  { name: 'Botol Kecap',         L:  62.30, W:  62.10, status: 'OK', conf: 0.91 },
  { name: 'Tutup Panci',         L: 220.40, W: 220.10, status: 'OK', conf: 0.89 },
  { name: 'Spidol Whiteboard',   L: 138.20, W:  16.40, status: 'OK', conf: 0.93 },
  { name: 'Penghapus Stedler',   L:  35.50, W:  22.10, status: 'OK', conf: 0.95 },
  { name: 'Buku Tulis A4',       L: 297.00, W: 210.00, status: 'OK', conf: 0.97 },
  { name: 'Pulpen Standard',     L: 145.20, W:  11.80, status: 'OK', conf: 0.92 },
  { name: 'Mug Keramik',         L:  95.00, W:  88.50, status: 'NG', conf: 0.87 },
  { name: 'Piring Makan',        L: 250.00, W: 248.30, status: 'NG', conf: 0.82 },
  { name: 'Sendok Stainless',    L: 175.30, W:  38.20, status: 'OK', conf: 0.90 },
  { name: 'Garpu Stainless',     L: 175.10, W:  27.40, status: 'OK', conf: 0.91 },
  { name: 'Gelas Plastik',       L: 110.00, W:  75.50, status: 'NG', conf: 0.79 },
  { name: 'Kotak Kardus Sedang', L: 305.00, W: 245.00, status: 'OK', conf: 0.94 },
  { name: 'Botol Air Mineral',   L: 220.00, W:  65.40, status: 'OK', conf: 0.93 },
  { name: 'USB Flashdisk 32GB',  L:  56.20, W:  18.50, status: 'OK', conf: 0.95 },
];

const INTERVAL_MS = 5000;

// ── ANSI colors ───────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', yellow: '\x1b[33m',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getNextId() {
  const r = await pgPool.query('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM inspections');
  return Number(r.rows[0].next);
}

async function insertViaDml(id, sample) {
  await pgPool.query(
    `INSERT INTO inspections
       (id, object_name, dimension_mm, width_mm, confidence, status, "timestamp")
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [id, sample.name, sample.L, sample.W, sample.conf, sample.status],
  );
  return id;
}

async function insertViaRest(sample) {
  const r = await fetch('http://localhost:3000/inspection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dimension_mm: sample.L,
      width_mm:     sample.W,
      status:       sample.status,
      confidence:   sample.conf,
      object_name:  sample.name,
    }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`REST ${r.status}: ${json?.message}`);
  return json.data.id;
}

async function main() {
  const mode = usePostMode ? 'REST POST (JSON + PG sync)' : 'DIRECT DML (PG only)';
  console.log(`${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}║   DML Injection — 15 rows × 5s interval                          ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}║   Mode: ${mode.padEnd(56)}║${C.reset}`);
  console.log(`${C.cyan}${C.bold}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}  Total ETA: ~${(SAMPLES.length - 1) * INTERVAL_MS / 1000}s${C.reset}`);
  console.log('');

  let nextId = await getNextId();
  console.log(`${C.dim}  Starting from id=${nextId}${C.reset}\n`);

  let okCount = 0, ngCount = 0, fail = 0;
  const startTime = Date.now();

  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];
    const idx = String(i + 1).padStart(2, ' ');
    const id = nextId++;
    const ts = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
    const statusColor = s.status === 'OK' ? C.green : C.red;

    try {
      if (usePostMode) {
        await insertViaRest(s);
      } else {
        await insertViaDml(id, s);
      }
      console.log(
        `  ${C.dim}[${ts}]${C.reset} ${C.bold}${idx}/15${C.reset} ` +
        `${C.cyan}id=${id}${C.reset}  ` +
        `${s.name.padEnd(24)} ` +
        `L=${C.bold}${s.L.toFixed(2).padStart(7)}${C.reset}mm ` +
        `W=${C.bold}${s.W.toFixed(2).padStart(7)}${C.reset}mm ` +
        `conf=${(s.conf * 100).toFixed(0)}%  ` +
        `${statusColor}${s.status}${C.reset}`
      );
      if (s.status === 'OK') okCount++; else ngCount++;
    } catch (e) {
      console.log(`  ${C.red}${idx}/15  FAIL  ${s.name}: ${e.message}${C.reset}`);
      fail++;
    }

    // Sleep antar row, kecuali di iterasi terakhir
    if (i < SAMPLES.length - 1) {
      await sleep(INTERVAL_MS);
    }
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);

  // Ringkasan
  console.log('');
  console.log(`${C.cyan}${C.bold}═══════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  Summary${C.reset}`);
  console.log(`${C.cyan}═══════════════════════════════════════════════════════${C.reset}`);
  console.log(`  Total inserted : ${okCount + ngCount} rows`);
  console.log(`  ${C.green}OK             : ${okCount}${C.reset}`);
  console.log(`  ${C.red}NG             : ${ngCount}${C.reset}`);
  if (fail > 0) console.log(`  ${C.yellow}Failed         : ${fail}${C.reset}`);
  console.log(`  Wall-clock     : ${totalSec}s`);

  // Verifikasi dengan query agregasi
  console.log(`\n${C.bold}  Verifying via PG aggregation:${C.reset}`);
  const verify = await pgPool.query(`
    SELECT object_name, COUNT(*) AS n, status
    FROM inspections
    WHERE object_name = ANY($1::text[])
    GROUP BY object_name, status
    ORDER BY object_name`,
    [SAMPLES.map(s => s.name)]);
  for (const row of verify.rows) {
    const c = row.status === 'OK' ? C.green : C.red;
    console.log(`    ${c}${row.status}${C.reset}  ${row.object_name.padEnd(24)} × ${row.n}`);
  }

  console.log(`\n${C.dim}  Cek di dashboard:  http://localhost:3000${C.reset}`);
  console.log(`${C.dim}  Cek via REST:      curl http://localhost:3000/api/v1/inspection?limit=20${C.reset}`);
  console.log(`${C.dim}  Cek via psql:      psql … -c "SELECT * FROM v_inspection_summary"${C.reset}`);

  await pgPool.end();
}

main().catch(e => {
  console.error(`${C.red}FATAL: ${e.message}${C.reset}`);
  process.exit(1);
});
