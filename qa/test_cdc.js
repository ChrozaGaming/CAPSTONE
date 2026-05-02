#!/usr/bin/env node
/**
 * qa/test_cdc.js
 *
 * SQA suite untuk Bidirectional CDC Sync (v2.3).
 *
 * Memverifikasi setiap requirement user:
 *   1. Dashboard baca dari PG (BUKAN session storage browser)
 *   2. Real-time WebSocket dengan PG (event push pada PG state change)
 *   3. JSON sebagai mirror/backup paralel
 *   4. PG → JSON sync (psql INSERT/UPDATE/DELETE/TRUNCATE → JSON ikut)
 *   5. JSON → PG sync (edit JSON manual → PG ikut, termasuk DELETE)
 *   6. REST operasi → konsisten di kedua store
 *   7. Safety: internal lock cegah feedback loop
 *
 * Pre-requisites:
 *   - server.js running on http://localhost:3000
 *   - db/schema.sql + db/triggers.sql sudah di-apply
 *
 * Run:    node qa/test_cdc.js
 * Output: console + qa/REPORT_CDC.md
 */

'use strict';
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const WebSocket = require('ws');
const { Pool } = require('pg');

// ══════════════════════════════════════════════════════════════════════
//  REPORT METADATA
// ══════════════════════════════════════════════════════════════════════
const TESTER = {
  name:        'Hilmy Raihan Alkindy',
  role:        'Quality Assurance Engineer',
  email:       'hilmyraihankindy@gmail.com',
  affiliation: 'Capstone A3 Kelompok 2 — Filkom Universitas Brawijaya',
};

const PROJECT = {
  name:        'Automated Dimensional Inspection',
  module:      'Bidirectional CDC Sync (PG ↔ JSON ↔ WebSocket)',
  repository:  'https://github.com/ChrozaGaming/CAPSTONE',
};

const TEST_PLAN = {
  document_id:   'SQA-CDC-002',
  revision:      'rev. 1.0',
  test_level:    'Integration / End-to-End / Data Consistency',
  test_strategy: 'Black-box (REST/WS contract) + Gray-box (DB triggers + file watcher)',
  pass_criteria: '100% TC PASS — bidirectional sync teruji untuk semua sumber perubahan',
};

// ── Configuration ─────────────────────────────────────────────────────
const REST_BASE = process.env.QA_REST_BASE || 'http://localhost:3000';
const WS_URL    = process.env.QA_WS_URL    || 'ws://localhost:3000/ws';
const JSON_PATH = path.join(__dirname, '..', 'data', 'inspections.json');
const RUN_START_TIME = new Date();
const TEST_MARKER = `CDC-${Date.now()}`;

const pgPool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number.parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'capstone',
});

// ── ANSI colors ───────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', yellow: '\x1b[33m', gray: '\x1b[90m',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Test runner ───────────────────────────────────────────────────────
const results = [];

async function tc(id, category, description, fn) {
  const start = Date.now();
  let status = 'PASS', error = null;
  try { await fn(); }
  catch (e) { status = 'FAIL'; error = e.message || String(e); }
  const ms = Date.now() - start;
  results.push({ id, category, description, status, ms, error });
  const symbol = status === 'PASS' ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  const colorMs = ms > 1500 ? C.yellow : C.gray;
  console.log(
    `  ${symbol}  ${C.bold}${id}${C.reset}  ${description.padEnd(60)} ${colorMs}${String(ms).padStart(5)}ms${C.reset}` +
    (error ? `\n      ${C.red}└─ ${error}${C.reset}` : '')
  );
}

function header(text) {
  console.log(`\n${C.cyan}${C.bold}━━━ ${text} ━━━${C.reset}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'mismatch'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function rest(method, p, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${REST_BASE}${p}`, opts);
  let json = null;
  try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json };
}

// ── Helpers untuk WS event collection ─────────────────────────────────
async function withWsCapture(eventTypes, durationMs, action) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const captured = [];
    let timer = null;
    ws.on('open', async () => {
      try {
        await action();
      } catch (e) { reject(e); return; }
      timer = setTimeout(() => { ws.close(); resolve(captured); }, durationMs);
    });
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw);
        if (eventTypes.includes(m.type)) captured.push(m);
      } catch { /* */ }
    });
    ws.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
  });
}

function readJson() {
  return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
}

function writeJson(data) {
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
}

// ── Cleanup helpers ───────────────────────────────────────────────────
async function fullReset() {
  await pgPool.query('TRUNCATE TABLE inspections');
  // Wait for trigger NOTIFY to propagate to JSON (flushes JSON to [])
  await sleep(800);
}

// ═════════════════════════════════════════════════════════════════════
//  TEST CASES
// ═════════════════════════════════════════════════════════════════════
async function runAll() {
  console.log(`${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}║   SQA TEST SUITE — Bidirectional CDC Sync (v2.3)                 ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}║   PG ↔ server.js ↔ JSON ↔ WebSocket                              ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}  Marker: ${TEST_MARKER}${C.reset}`);
  console.log(`${C.dim}  Target: ${REST_BASE}  ·  ${WS_URL}${C.reset}`);

  // ─────────────────────────────────────────────────────────────────
  header('A. CONNECTIVITY & PRE-CONDITIONS');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-A01', 'connectivity', 'REST server reachable', async () => {
    const r = await rest('GET', '/api/v1/status');
    assertEqual(r.status, 200);
  });

  await tc('TC-A02', 'connectivity', 'PostgreSQL connected (pgReady=true)', async () => {
    const r = await rest('GET', '/api/v1/status');
    assert(r.json?.pg?.connected === true, 'pg.connected must be true');
  });

  await tc('TC-A03', 'connectivity', 'WebSocket /ws handshake', async () => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const t = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 3000);
      ws.on('open', () => { clearTimeout(t); ws.close(); resolve(); });
      ws.on('error', (e) => { clearTimeout(t); reject(e); });
    });
  });

  await tc('TC-A04', 'connectivity', 'PG triggers installed (inspection_change_trigger)', async () => {
    const r = await pgPool.query(
      `SELECT 1 FROM pg_trigger WHERE tgname='inspection_change_trigger'`);
    assert(r.rowCount === 1, 'trigger missing — apply db/triggers.sql');
  });

  // Bersihkan state untuk test bersih
  await fullReset();

  // ─────────────────────────────────────────────────────────────────
  header('B. DASHBOARD READS FROM POSTGRESQL (bukan session storage)');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-B01', 'dashboard-pg', 'GET /inspection returns source=postgres when PG up', async () => {
    const r = await rest('GET', '/inspection');
    assertEqual(r.status, 200);
    assertEqual(r.json?.source, 'postgres', 'must read from PG, not JSON');
  });

  await tc('TC-B02', 'dashboard-pg', 'Direct psql INSERT visible via GET /inspection within 1s', async () => {
    await pgPool.query(`
      INSERT INTO inspections (id, object_name, dimension_mm, status)
      VALUES (5001, $1, 50.0, 'OK')`, [`${TEST_MARKER}-B02`]);
    await sleep(800); // wait for any async propagation
    const r = await rest('GET', '/inspection');
    const found = r.json?.data?.find(d => d.id === 5001);
    assert(found, `id=5001 not visible via GET /inspection`);
    assertEqual(found.object_name, `${TEST_MARKER}-B02`);
  });

  await tc('TC-B03', 'dashboard-pg', 'Browser-cached state irrelevant — server returns fresh PG state', async () => {
    // Insert kedua row langsung ke PG
    await pgPool.query(`
      INSERT INTO inspections (id, object_name, dimension_mm, status)
      VALUES (5002, $1, 60.0, 'NG')`, [`${TEST_MARKER}-B03`]);
    await sleep(800);
    const r = await rest('GET', '/inspection');
    const found = r.json?.data?.find(d => d.id === 5002);
    assert(found, 'fresh PG row not in REST response — server might be caching');
    assertEqual(found.status, 'NG');
  });

  // ─────────────────────────────────────────────────────────────────
  header('C. PG → JSON SYNC (psql triggers fire NOTIFY → server replicates)');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-C01', 'pg-to-json', 'psql INSERT row → JSON file gets row within 1.5s', async () => {
    await pgPool.query(`
      INSERT INTO inspections (id, object_name, dimension_mm, status)
      VALUES (5003, $1, 70.0, 'OK')`, [`${TEST_MARKER}-C01`]);
    await sleep(1200);
    const json = readJson();
    const found = json.find(r => r.id === 5003);
    assert(found, 'JSON file did not receive INSERT from PG trigger');
    assertEqual(found.object_name, `${TEST_MARKER}-C01`);
  });

  await tc('TC-C02', 'pg-to-json', 'psql UPDATE row → JSON row updated within 1.5s', async () => {
    await pgPool.query(`UPDATE inspections SET status='NG' WHERE id=5003`);
    await sleep(1200);
    const json = readJson();
    const found = json.find(r => r.id === 5003);
    assert(found, 'row missing after UPDATE');
    assertEqual(found.status, 'NG', 'JSON did not reflect UPDATE');
  });

  await tc('TC-C03', 'pg-to-json', 'psql DELETE row → JSON row removed within 1.5s', async () => {
    await pgPool.query(`DELETE FROM inspections WHERE id=5003`);
    await sleep(1200);
    const json = readJson();
    const found = json.find(r => r.id === 5003);
    assert(!found, 'JSON still has deleted row');
  });

  await tc('TC-C04', 'pg-to-json', 'psql TRUNCATE → JSON cleared within 1.5s', async () => {
    await pgPool.query(`
      INSERT INTO inspections (id, object_name, dimension_mm, status)
      VALUES (5004, $1, 80.0, 'OK'), (5005, $2, 90.0, 'OK')`,
      [`${TEST_MARKER}-C04a`, `${TEST_MARKER}-C04b`]);
    await sleep(800);
    await pgPool.query(`TRUNCATE TABLE inspections`);
    await sleep(1200);
    const json = readJson();
    const ours = json.filter(r => r.object_name?.startsWith(TEST_MARKER));
    assertEqual(ours.length, 0, `expected 0 test rows after TRUNCATE, got ${ours.length}`);
  });

  // ─────────────────────────────────────────────────────────────────
  header('D. JSON → PG SYNC (file watcher → reconcile push)');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-D01', 'json-to-pg', 'Edit JSON manual (add row) → PG INSERT within 2.5s', async () => {
    const data = readJson();
    data.push({
      id: 5010,
      object_name: `${TEST_MARKER}-D01`,
      dimension_mm: 100.0,
      width_mm: 50.0,
      confidence: 0.9,
      status: 'OK',
      timestamp: new Date().toISOString(),
    });
    writeJson(data);
    await sleep(2200);
    const r = await pgPool.query('SELECT * FROM inspections WHERE id=5010');
    assertEqual(r.rowCount, 1, 'JSON edit did not propagate to PG');
    assertEqual(r.rows[0].object_name, `${TEST_MARKER}-D01`);
  });

  await tc('TC-D02', 'json-to-pg', 'Edit JSON manual (remove row) → PG DELETE within 2.5s', async () => {
    const data = readJson();
    const filtered = data.filter(r => r.id !== 5010);
    writeJson(filtered);
    await sleep(2200);
    const r = await pgPool.query('SELECT 1 FROM inspections WHERE id=5010');
    assertEqual(r.rowCount, 0, 'JSON delete did not propagate to PG');
  });

  await tc('TC-D03', 'json-to-pg', 'Safety: JSON corrupt (sintaks salah) → PG TIDAK dihapus', async () => {
    // v2.2.0+: empty JSON file = INTENTIONAL wipe (user explicit clear).
    // Yang tetap dipertahankan adalah PG ketika JSON corrupt/parse error
    // — bukan hanya "tiba-tiba kosong" tapi memang gak bisa di-parse.
    //
    // Setup: bikin 6 row di PG
    for (let i = 0; i < 6; i++) {
      await pgPool.query(`
        INSERT INTO inspections (id, object_name, dimension_mm, status)
        VALUES ($1, $2, 10.0, 'OK')`, [6000 + i, `${TEST_MARKER}-D03-${i}`]);
    }
    await sleep(1500); // wait for sync

    // Tulis JSON dengan sintaks rusak (bukan empty — empty itu intent wipe)
    fs.writeFileSync(JSON_PATH, '{ this is not valid json at all }');
    await sleep(2500);

    // PG harus tetap utuh karena strict parse error → reconcile skip
    const r = await pgPool.query(
      `SELECT COUNT(*)::int AS n FROM inspections WHERE object_name LIKE $1`,
      [`${TEST_MARKER}-D03%`]);
    assert(r.rows[0].n >= 6, `safety failed — PG lost data on JSON corrupt: ${r.rows[0].n} remain`);

    // Cleanup
    await pgPool.query(`DELETE FROM inspections WHERE object_name LIKE $1`,
      [`${TEST_MARKER}-D03%`]);
    // Restore JSON ke valid format supaya test selanjutnya tidak terpengaruh
    fs.writeFileSync(JSON_PATH, '[]');
    await sleep(1500);
  });

  // ─────────────────────────────────────────────────────────────────
  header('E. REAL-TIME WEBSOCKET (PG state change → WS push)');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-E01', 'realtime-ws', 'psql INSERT → WS event "inspection.created"', async () => {
    const events = await withWsCapture(['inspection.created'], 1500, async () => {
      await sleep(150); // ensure WS subscribed
      await pgPool.query(`
        INSERT INTO inspections (id, object_name, dimension_mm, status)
        VALUES (5020, $1, 11.0, 'OK')`, [`${TEST_MARKER}-E01`]);
    });
    const ours = events.find(e => e.data?.id === 5020);
    assert(ours, `no WS push for psql INSERT (received ${events.length} events)`);
    assertEqual(ours.data.object_name, `${TEST_MARKER}-E01`);
  });

  await tc('TC-E02', 'realtime-ws', 'psql DELETE → WS event "inspection.deleted"', async () => {
    const events = await withWsCapture(['inspection.deleted'], 1500, async () => {
      await sleep(150);
      await pgPool.query(`DELETE FROM inspections WHERE id=5020`);
    });
    const ours = events.find(e => e.data?.id === 5020);
    assert(ours, 'no WS push for psql DELETE');
  });

  await tc('TC-E03', 'realtime-ws', 'REST POST /inspection → WS event "inspection.created"', async () => {
    const events = await withWsCapture(['inspection.created'], 1500, async () => {
      await sleep(150);
      await rest('POST', '/inspection', {
        dimension_mm: 22.5, width_mm: 11.0, status: 'OK',
        object_name: `${TEST_MARKER}-E03`,
      });
    });
    const ours = events.find(e => e.data?.object_name === `${TEST_MARKER}-E03`);
    assert(ours, 'no WS push for REST POST');
  });

  // ─────────────────────────────────────────────────────────────────
  header('F. REST OPERATIONS — KONSISTEN DI KEDUA STORE');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-F01', 'rest-consistency', 'REST POST → row di PG dan JSON identik', async () => {
    const r = await rest('POST', '/inspection', {
      dimension_mm: 33.3, width_mm: 22.0, status: 'OK', confidence: 0.95,
      object_name: `${TEST_MARKER}-F01`,
    });
    assertEqual(r.status, 201);
    const id = r.json?.data?.id;
    assert(id, 'no id assigned');
    await sleep(800);
    const pg = await pgPool.query('SELECT * FROM inspections WHERE id=$1', [id]);
    const json = readJson().find(x => x.id === id);
    assertEqual(pg.rowCount, 1, 'PG missing');
    assert(json, 'JSON missing');
    assertEqual(pg.rows[0].object_name, json.object_name, 'object_name mismatch PG vs JSON');
    assertEqual(Number(pg.rows[0].dimension_mm), json.dimension_mm, 'dimension_mm mismatch');
  });

  await tc('TC-F02', 'rest-consistency', 'REST DELETE /inspection/:id → both stores updated', async () => {
    // Create
    const r1 = await rest('POST', '/inspection', {
      dimension_mm: 44.4, status: 'OK', object_name: `${TEST_MARKER}-F02`,
    });
    const id = r1.json.data.id;
    await sleep(500);
    // Delete
    const r2 = await rest('DELETE', `/inspection/${id}`);
    assertEqual(r2.status, 200);
    await sleep(800);
    // Verify
    const pg = await pgPool.query('SELECT 1 FROM inspections WHERE id=$1', [id]);
    const inJson = readJson().some(x => x.id === id);
    assertEqual(pg.rowCount, 0, 'PG row not deleted');
    assert(!inJson, 'JSON row not deleted');
  });

  await tc('TC-F03', 'rest-consistency', 'REST DELETE /inspection (clear all) → both cleared', async () => {
    const r = await rest('DELETE', '/inspection');
    assertEqual(r.status, 200);
    await sleep(1000);
    const pg = await pgPool.query('SELECT COUNT(*)::int AS n FROM inspections');
    const json = readJson();
    assertEqual(pg.rows[0].n, 0, 'PG not empty');
    assertEqual(json.length, 0, 'JSON not empty');
  });

  // ─────────────────────────────────────────────────────────────────
  header('G. SAFETY & FEEDBACK LOOP PREVENTION');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-G01', 'safety', 'Server own write tidak men-trigger watcher (no infinite loop)', async () => {
    // Hitung event WS yang muncul saat 1 REST POST
    const events = await withWsCapture(['inspection.created'], 2000, async () => {
      await sleep(150);
      await rest('POST', '/inspection', {
        dimension_mm: 55.5, status: 'OK', object_name: `${TEST_MARKER}-G01`,
      });
    });
    const ours = events.filter(e => e.data?.object_name === `${TEST_MARKER}-G01`);
    assert(ours.length >= 1, 'no event for own POST');
    assert(ours.length <= 3, `too many duplicate events (${ours.length}) — possible feedback loop`);
  });

  await tc('TC-G02', 'safety', 'Trigger function dan listener client masih hidup', async () => {
    // Verifikasi listener masih subscribe (kirim NOTIFY manual)
    const events = await withWsCapture(['inspection.created'], 1500, async () => {
      await sleep(150);
      await pgPool.query(`
        INSERT INTO inspections (id, object_name, dimension_mm, status)
        VALUES (5099, $1, 99.0, 'OK')`, [`${TEST_MARKER}-G02`]);
    });
    const ours = events.find(e => e.data?.id === 5099);
    assert(ours, 'listener seems disconnected — no event from psql INSERT');
    await pgPool.query('DELETE FROM inspections WHERE id=5099');
  });

  // ─────────────────────────────────────────────────────────────────
  header('H. CLEANUP');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-H01', 'cleanup', 'Hapus semua row test (PG + JSON sync via TRUNCATE)', async () => {
    await pgPool.query(`DELETE FROM inspections WHERE object_name LIKE $1`,
      [`${TEST_MARKER}%`]);
    await sleep(1000);
    const json = readJson();
    const remaining = json.filter(r => r.object_name?.startsWith(TEST_MARKER));
    assertEqual(remaining.length, 0, `${remaining.length} test rows still in JSON`);
  });

  // ═════════════════════════════════════════════════════════════════
  //  REPORT
  // ═════════════════════════════════════════════════════════════════
  printSummary();
  await saveMarkdownReport();

  await pgPool.end();
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
}

// ── Reporting (sama seperti test_suite.js) ────────────────────────────
function printSummary() {
  const total  = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = total - passed;
  const totalMs = results.reduce((a, r) => a + r.ms, 0);
  const verdict = failed === 0
    ? `${C.green}${C.bold}ALL TESTS PASSED ✓${C.reset}`
    : `${C.red}${C.bold}${failed} TEST(S) FAILED ✗${C.reset}`;

  console.log('');
  console.log(`${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}║  CDC SYNC SUMMARY                                                ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}╠══════════════════════════════════════════════════════════════════╣${C.reset}`);
  const padLine = (s) => `${C.cyan}║${C.reset}  ${s}`.padEnd(75) + `${C.cyan}║${C.reset}`;
  console.log(padLine(`Total tests   : ${total}`));
  console.log(padLine(`Passed        : ${C.green}${passed}${C.reset}`));
  console.log(padLine(`Failed        : ${failed === 0 ? C.green : C.red}${failed}${C.reset}`));
  console.log(padLine(`Total duration: ${totalMs}ms`));
  console.log(padLine(`Pass rate     : ${((passed/total)*100).toFixed(1)}%`));
  console.log(padLine(`Verdict       : ${verdict}`));
  console.log(`${C.cyan}${C.bold}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);

  const byCat = {};
  for (const r of results) {
    if (!byCat[r.category]) byCat[r.category] = { pass: 0, fail: 0 };
    byCat[r.category][r.status === 'PASS' ? 'pass' : 'fail']++;
  }
  console.log(`\n${C.bold}Category Breakdown:${C.reset}`);
  for (const [cat, c] of Object.entries(byCat)) {
    const tot = c.pass + c.fail;
    const ok = c.fail === 0;
    console.log(`  ${ok ? C.green + '✓' : C.red + '✗'}${C.reset}  ${cat.padEnd(20)} ${c.pass}/${tot} passed`);
  }

  if (failed > 0) {
    console.log(`\n${C.red}${C.bold}Failed tests:${C.reset}`);
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  ${C.red}✗ ${r.id}${C.reset}  ${r.description}`);
      console.log(`    ${C.dim}└─ ${r.error}${C.reset}`);
    }
  }
}

function safeExec(cmd, fallback = 'unknown') {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return fallback; }
}

function loadProjectVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch { return 'unknown'; }
}

async function loadPgVersion() {
  try { return (await pgPool.query('SHOW server_version')).rows[0].server_version; }
  catch { return 'unknown'; }
}

async function gatherEnvironment() {
  return {
    project_version: loadProjectVersion(),
    git_branch:      safeExec('git rev-parse --abbrev-ref HEAD'),
    git_commit:      safeExec('git rev-parse --short HEAD'),
    git_dirty:       safeExec('git status --porcelain') ? 'YES (uncommitted changes)' : 'NO',
    node_version:    process.version,
    pg_version:      await loadPgVersion(),
    os:              `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    cpu:             `${os.cpus()[0]?.model} × ${os.cpus().length}`,
    hostname:        os.hostname(),
    user:            os.userInfo().username,
  };
}

async function saveMarkdownReport() {
  const total  = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = total - passed;
  const totalMs = results.reduce((a, r) => a + r.ms, 0);
  const passRate = ((passed / total) * 100).toFixed(1);
  const env = await gatherEnvironment();
  const verdict = failed === 0
    ? '✅ **ALL TESTS PASSED — BIDIRECTIONAL CDC SYNC VERIFIED**'
    : `❌ **${failed} TEST(S) FAILED**`;

  let md = `# CDC Sync Test Report — ${PROJECT.name} v${env.project_version}\n\n`;
  md += `> ${verdict}\n\n`;

  md += `## 📄 Document Metadata\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Document ID | \`${TEST_PLAN.document_id}\` |\n`;
  md += `| Revision | ${TEST_PLAN.revision} |\n`;
  md += `| Generated | ${new Date().toISOString()} |\n`;
  md += `| Generated (local) | ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB |\n\n`;

  md += `## 👤 Tester\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Name | **${TESTER.name}** |\n`;
  md += `| Email | ${TESTER.email} |\n`;
  md += `| Affiliation | ${TESTER.affiliation} |\n\n`;

  md += `## 🎯 Project & Module\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Project | ${PROJECT.name} |\n`;
  md += `| Version | \`v${env.project_version}\` |\n`;
  md += `| Module | ${PROJECT.module} |\n`;
  md += `| Git branch / commit | \`${env.git_branch}\` / \`${env.git_commit}\` |\n`;
  md += `| Working tree dirty | ${env.git_dirty} |\n\n`;

  md += `## 📋 Test Plan\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Test level | ${TEST_PLAN.test_level} |\n`;
  md += `| Test strategy | ${TEST_PLAN.test_strategy} |\n`;
  md += `| Pass criteria | ${TEST_PLAN.pass_criteria} |\n\n`;

  md += `## 🎯 Requirement Coverage\n\n`;
  md += `Setiap kategori memetakan ke requirement user:\n\n`;
  md += `| Requirement (user request) | Section | Status |\n|---|---|---|\n`;
  const reqMap = [
    ['Dashboard baca dari PG, BUKAN session storage browser', 'B', 'dashboard-pg'],
    ['Real-time WS push pada perubahan PG', 'E', 'realtime-ws'],
    ['JSON sebagai mirror untuk riwayat/backup', 'F', 'rest-consistency'],
    ['psql DELETE/INSERT → JSON ikut sync', 'C', 'pg-to-json'],
    ['JSON edit → PG ikut sync (FK-like)', 'D', 'json-to-pg'],
    ['Safety: tidak ada feedback loop', 'G', 'safety'],
  ];
  for (const [req, sec, cat] of reqMap) {
    const cs = results.filter(r => r.category === cat);
    const ok = cs.length > 0 && cs.every(r => r.status === 'PASS');
    md += `| ${req} | ${sec} | ${ok ? '✅ Verified' : '❌ Failed'} |\n`;
  }
  md += `\n`;

  md += `## 🖥 Environment\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Hostname | \`${env.hostname}\` |\n`;
  md += `| OS | ${env.os} |\n`;
  md += `| CPU | ${env.cpu} |\n`;
  md += `| Node.js | ${env.node_version} |\n`;
  md += `| PostgreSQL | ${env.pg_version} |\n`;
  md += `| Targets | REST \`${REST_BASE}\` · WS \`${WS_URL}\` |\n\n`;

  md += `---\n\n## 🏁 Verdict\n\n${verdict}\n\n`;
  md += `## 📊 Executive Summary\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Total test cases | ${total} |\n`;
  md += `| Passed | **${passed}** ✅ |\n`;
  md += `| Failed | ${failed} ${failed === 0 ? '' : '❌'} |\n`;
  md += `| Pass rate | **${passRate}%** |\n`;
  md += `| Total duration | ${totalMs}ms |\n`;
  md += `| Test marker | \`${TEST_MARKER}\` |\n\n`;

  const byCat = {};
  for (const r of results) {
    if (!byCat[r.category]) byCat[r.category] = { pass: 0, fail: 0, ms: 0 };
    byCat[r.category][r.status === 'PASS' ? 'pass' : 'fail']++;
    byCat[r.category].ms += r.ms;
  }
  md += `## 🗂 Category Breakdown\n\n`;
  md += `| Category | Passed | Failed | Pass Rate | Duration | Status |\n|---|---|---|---|---|---|\n`;
  for (const [cat, c] of Object.entries(byCat)) {
    const tot = c.pass + c.fail;
    const rate = ((c.pass / tot) * 100).toFixed(0);
    const status = c.fail === 0 ? '✅' : '❌';
    md += `| \`${cat}\` | ${c.pass} | ${c.fail} | ${rate}% | ${c.ms}ms | ${status} |\n`;
  }
  md += `\n`;

  md += `## 🔍 Detailed Results\n\n`;
  md += `| ID | Category | Description | Status | Duration |\n|---|---|---|---|---|\n`;
  for (const r of results) {
    const symbol = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    md += `| \`${r.id}\` | ${r.category} | ${r.description} | ${symbol} | ${r.ms}ms |\n`;
  }
  md += `\n`;

  if (failed > 0) {
    md += `## ⚠️ Failed Tests\n\n`;
    for (const r of results.filter(r => r.status === 'FAIL')) {
      md += `### ${r.id} — ${r.description}\n\n`;
      md += `\`\`\`\n${r.error}\n\`\`\`\n\n`;
    }
  }

  md += `---\n\n## ✍️ Sign-off\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Tested by | ${TESTER.name} |\n`;
  md += `| Date | ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB |\n`;
  md += `| Recommendation | ${failed === 0 ? '**Approve.** Bidirectional sync teruji untuk semua sumber perubahan.' : '**Block release.**'} |\n\n`;
  md += `---\n\n*Hak Cipta © Capstone Topik A3 Kelompok 2, Filkom Universitas Brawijaya.*\n`;

  const out = path.join(__dirname, 'REPORT_CDC.md');
  fs.writeFileSync(out, md);
  console.log(`\n${C.dim}Report saved to: ${out}${C.reset}`);
}

runAll().catch(e => {
  console.error(`\n${C.red}${C.bold}FATAL: ${e.message}${C.reset}`);
  console.error(e.stack);
  process.exit(2);
});
