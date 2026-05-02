#!/usr/bin/env node
/**
 * qa/test_suite.js
 *
 * End-to-end SQA test suite untuk Automated Dimensional Inspection v2.2.
 * Verifies hybrid integration:
 *   - REST POST /inspection            → JSON + PG mirror + WS broadcast
 *   - PG direct DML (INSERT/UPDATE)    → visible via /api/v1/inspection
 *   - WebSocket subscription           → real-time push events
 *   - Analytics views (PG views)       → /api/v1/stats/*
 *   - Validation                       → invalid input rejected at REST + PG
 *   - Cleanup                          → DELETE /inspection clears both stores
 *
 * Pre-requisites:
 *   - server.js running on http://localhost:3000
 *   - PostgreSQL connected (pg.connected=true di /api/v1/status)
 *   - db/schema.sql sudah di-apply
 *
 * Run:    node qa/test_suite.js
 * Output: console + qa/REPORT.md
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
//  REPORT METADATA — edit di sini untuk identitas tester / project
// ══════════════════════════════════════════════════════════════════════
const TESTER = {
  name:        'Hilmy Raihan Alkindy',
  role:        'Quality Assurance Engineer',
  email:       'hilmyraihankindy@gmail.com',
  affiliation: 'Capstone A3 Kelompok 2 — Filkom Universitas Brawijaya',
};

const PROJECT = {
  name:        'Automated Dimensional Inspection',
  module:      'Backend Hybrid Integration (REST + PostgreSQL + WebSocket)',
  repository:  'https://github.com/ChrozaGaming/CAPSTONE',
};

const TEST_PLAN = {
  document_id:   'SQA-DIM-INSP-001',
  revision:      'rev. 1.0',
  test_level:    'Integration / End-to-End',
  test_strategy: 'Black-box (REST API contract) + White-box (direct PG DML)',
  pass_criteria: '100% TC PASS, no critical/major defect',
};

// ── Configuration ─────────────────────────────────────────────────────
const REST_BASE = process.env.QA_REST_BASE || 'http://localhost:3000';
const WS_URL    = process.env.QA_WS_URL    || 'ws://localhost:3000/ws';
const RUN_START_TIME = new Date();

const pgPool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number.parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'capstone',
});

// ── ANSI colors ───────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  green: '\x1b[32m',
  red:   '\x1b[31m',
  yellow:'\x1b[33m',
  cyan:  '\x1b[36m',
  gray:  '\x1b[90m',
};

// ── Test runner state ─────────────────────────────────────────────────
const results = [];

async function tc(id, category, description, fn) {
  const start = Date.now();
  let status = 'PASS';
  let error = null;
  try {
    await fn();
  } catch (e) {
    status = 'FAIL';
    error = e.message || String(e);
  }
  const ms = Date.now() - start;
  results.push({ id, category, description, status, ms, error });
  const symbol = status === 'PASS' ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  const colorMs = ms > 500 ? C.yellow : C.gray;
  console.log(
    `  ${symbol}  ${C.bold}${id}${C.reset}  ${description.padEnd(60)} ${colorMs}${String(ms).padStart(4)}ms${C.reset}` +
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

// ── Test data markers (untuk cleanup) ─────────────────────────────────
const TEST_MARKER = `SQA-${Date.now()}`;

async function rest(method, p, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${REST_BASE}${p}`, opts);
  let json = null;
  try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json };
}

// ═════════════════════════════════════════════════════════════════════
//  TEST CASES
// ═════════════════════════════════════════════════════════════════════
async function runAll() {
  console.log(`${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}║   SQA TEST SUITE — Automated Dimensional Inspection v2.2.0       ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}║   Hybrid Integration: REST · PostgreSQL DML · WebSocket          ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}  Marker prefix: ${TEST_MARKER}${C.reset}`);
  console.log(`${C.dim}  Target: ${REST_BASE}  ·  ${WS_URL}${C.reset}`);

  // ─────────────────────────────────────────────────────────────────
  header('A. CONNECTIVITY');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-A01', 'connectivity', 'REST server reachable on /api/v1/status', async () => {
    const r = await rest('GET', '/api/v1/status');
    assertEqual(r.status, 200, 'HTTP status');
    assert(r.json?.success === true, 'success flag');
  });

  await tc('TC-A02', 'connectivity', 'PostgreSQL connected (status.pg.connected=true)', async () => {
    const r = await rest('GET', '/api/v1/status');
    assert(r.json?.pg?.connected === true,
      'pg.connected must be true — periksa .env dan PG service');
  });

  await tc('TC-A03', 'connectivity', 'WebSocket handshake on /ws', async () => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const t = setTimeout(() => { ws.close(); reject(new Error('WS timeout 3s')); }, 3000);
      ws.on('open', () => { clearTimeout(t); ws.close(); resolve(); });
      ws.on('error', (e) => { clearTimeout(t); reject(e); });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  header('B. SCHEMA INTEGRITY (PostgreSQL)');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-B01', 'schema', 'Table public.inspections exists', async () => {
    const r = await pgPool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name='inspections'
       ) AS ok`);
    assert(r.rows[0].ok === true, 'inspections table missing');
  });

  await tc('TC-B02', 'schema', 'View v_inspection_summary exists', async () => {
    const r = await pgPool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.views
         WHERE table_schema='public' AND table_name='v_inspection_summary'
       ) AS ok`);
    assert(r.rows[0].ok === true, 'view missing — run db/schema.sql');
  });

  await tc('TC-B03', 'schema', 'View v_inspection_daily_trend exists', async () => {
    const r = await pgPool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.views
         WHERE table_schema='public' AND table_name='v_inspection_daily_trend'
       ) AS ok`);
    assert(r.rows[0].ok === true, 'view missing');
  });

  await tc('TC-B04', 'schema', 'Index idx_inspections_ts_desc exists', async () => {
    const r = await pgPool.query(
      `SELECT 1 FROM pg_indexes
       WHERE schemaname='public' AND indexname='idx_inspections_ts_desc'`);
    assert(r.rowCount === 1, 'index missing');
  });

  await tc('TC-B05', 'schema', 'CHECK constraint status IN (OK,NG)', async () => {
    let rejected = false;
    try {
      await pgPool.query(`
        INSERT INTO inspections (id, dimension_mm, status)
        VALUES (-99, 1.0, 'INVALID_STATUS')`);
    } catch (e) {
      rejected = e.message.includes('inspections_status_check') ||
                 e.message.includes('check constraint');
    }
    assert(rejected, 'PG must reject invalid status');
    await pgPool.query('DELETE FROM inspections WHERE id=-99'); // cleanup
  });

  await tc('TC-B06', 'schema', 'CHECK constraint dimension_mm > 0', async () => {
    let rejected = false;
    try {
      await pgPool.query(`
        INSERT INTO inspections (id, dimension_mm, status)
        VALUES (-98, -5.0, 'OK')`);
    } catch (e) {
      rejected = e.message.includes('inspections_dim_positive') ||
                 e.message.includes('check constraint');
    }
    assert(rejected, 'PG must reject negative dimension');
  });

  // ─────────────────────────────────────────────────────────────────
  header('C. REST WRITE PATH (edge_camera.py simulation)');
  // ─────────────────────────────────────────────────────────────────

  let restCreatedId = null;

  await tc('TC-C01', 'rest-write', 'POST /inspection accepts valid payload (status 201)', async () => {
    const r = await rest('POST', '/inspection', {
      dimension_mm: 85.6,
      width_mm: 53.98,
      status: 'OK',
      confidence: 0.95,
      object_name: `${TEST_MARKER}-rest-A`,
    });
    assertEqual(r.status, 201, 'expected 201 Created');
    assert(r.json?.success === true, 'success flag');
    assert(typeof r.json?.data?.id === 'number', 'id assigned');
    restCreatedId = r.json.data.id;
  });

  await tc('TC-C02', 'rest-write', 'POSTed row appears in JSON file (data/inspections.json)', async () => {
    const jsonPath = path.join(__dirname, '..', 'data', 'inspections.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const found = data.find(d => d.id === restCreatedId);
    assert(found, `id=${restCreatedId} not in JSON`);
    assertEqual(found.object_name, `${TEST_MARKER}-rest-A`, 'object_name match');
    assertEqual(found.status, 'OK', 'status match');
  });

  await tc('TC-C03', 'rest-write', 'POSTed row mirrored to PostgreSQL (id-consistent)', async () => {
    // Brief delay to allow async mirror to complete
    await new Promise(r => setTimeout(r, 200));
    const r = await pgPool.query('SELECT * FROM inspections WHERE id=$1', [restCreatedId]);
    assertEqual(r.rowCount, 1, `PG row id=${restCreatedId} missing`);
    assertEqual(r.rows[0].object_name, `${TEST_MARKER}-rest-A`, 'object_name match');
    assertEqual(Number(r.rows[0].dimension_mm), 85.6, 'dimension match');
  });

  await tc('TC-C04', 'rest-write', 'POST /inspection rejects missing dimension_mm (status 400)', async () => {
    const r = await rest('POST', '/inspection', { status: 'OK' });
    assertEqual(r.status, 400, 'expected 400');
    assert(r.json?.success === false, 'success=false');
  });

  await tc('TC-C05', 'rest-write', 'POST /inspection rejects invalid status (status 400)', async () => {
    const r = await rest('POST', '/inspection', { dimension_mm: 10, status: 'MAYBE' });
    assertEqual(r.status, 400, 'expected 400');
  });

  // ─────────────────────────────────────────────────────────────────
  header('D. WEBSOCKET BROADCAST');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-D01', 'websocket', 'WS receives inspection.created on POST', async () => {
    const events = await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const collected = [];
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Timeout — events: ${JSON.stringify(collected.map(e => e.type))}`));
      }, 4000);

      ws.on('open', async () => {
        // Trigger POST after WS connected
        setTimeout(() => {
          rest('POST', '/inspection', {
            dimension_mm: 99.99,
            width_mm: 11.11,
            status: 'OK',
            object_name: `${TEST_MARKER}-ws`,
          }).catch(() => {});
        }, 100);
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        collected.push(msg);
        if (msg.type === 'inspection.created' &&
            msg.data?.object_name === `${TEST_MARKER}-ws`) {
          clearTimeout(timeout);
          ws.close();
          resolve(collected);
        }
      });
      ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
    assert(events.some(e => e.type === 'hello'), 'hello event not received');
    assert(events.some(e => e.type === 'inspection.created'), 'inspection.created event not received');
  });

  await tc('TC-D02', 'websocket', 'WS receives pending.created on POST /api/pending', async () => {
    const event = await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 3000);
      ws.on('open', () => {
        setTimeout(() => {
          rest('POST', '/api/pending', { L_mm: 12.34, W_mm: 5.67 }).catch(() => {});
        }, 100);
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'pending.created') {
          clearTimeout(timeout);
          ws.close();
          resolve(msg);
        }
      });
      ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
    assert(event.data?.L_mm === 12.34, 'L_mm match');
  });

  // ─────────────────────────────────────────────────────────────────
  header('E. PostgreSQL DIRECT DML (external service simulation)');
  // ─────────────────────────────────────────────────────────────────
  // Skenario: external service (BI tool, ETL, admin) write langsung ke PG.
  // v2.2.0+: PG triggers + LISTEN/NOTIFY → row tampil di SEMUA endpoint
  // (REST /inspection, /api/v1/inspection, JSON file) karena server.js
  // mereplikasi NOTIFY → JSON sync.

  const dmlId = 999000 + Math.floor(Math.random() * 9999);

  await tc('TC-E01', 'pg-dml', 'Direct INSERT INTO inspections succeeds', async () => {
    await pgPool.query(`
      INSERT INTO inspections
        (id, object_name, dimension_mm, width_mm, confidence, status, "timestamp")
      VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [dmlId, `${TEST_MARKER}-dml`, 42.5, 21.3, 0.88, 'OK']);
  });

  await tc('TC-E02', 'pg-dml', 'Direct DML row visible via /api/v1/inspection (PG-backed)', async () => {
    const r = await rest('GET', `/api/v1/inspection?limit=500`);
    assertEqual(r.status, 200, 'HTTP 200');
    const found = r.json?.data?.find(d => d.id === dmlId);
    assert(found, `DML row id=${dmlId} not in /api/v1/inspection`);
    assertEqual(found.object_name, `${TEST_MARKER}-dml`, 'object_name match');
    assertEqual(r.json.source, 'postgres', 'source must be postgres when PG ready');
  });

  await tc('TC-E03', 'pg-dml', 'Direct DML row visible via /inspection too (PG → JSON sync)', async () => {
    // Wait for trigger NOTIFY → server LISTEN → JSON sync
    await new Promise(r => setTimeout(r, 1200));
    const r = await rest('GET', `/inspection`);
    const found = r.json?.data?.find(d => d.id === dmlId);
    assert(found, 'DML row should be visible at /inspection (PG-backed in v2.2.0)');
    assertEqual(r.json.source, 'postgres', 'GET /inspection now reads from PG when ready');
  });

  await tc('TC-E04', 'pg-dml', 'UPDATE via DML reflected in PG queries', async () => {
    await pgPool.query(`UPDATE inspections SET status='NG' WHERE id=$1`, [dmlId]);
    const r = await pgPool.query('SELECT status FROM inspections WHERE id=$1', [dmlId]);
    assertEqual(r.rows[0].status, 'NG', 'UPDATE took effect');
  });

  await tc('TC-E05', 'pg-dml', 'PG view v_inspection_summary aggregates DML row', async () => {
    const r = await pgPool.query(
      `SELECT total, ng_count FROM v_inspection_summary WHERE object_name=$1`,
      [`${TEST_MARKER}-dml`]);
    assertEqual(r.rowCount, 1, 'view should contain DML object');
    assert(Number(r.rows[0].ng_count) >= 1, 'NG count >= 1 after UPDATE');
  });

  // ─────────────────────────────────────────────────────────────────
  header('F. ANALYTICS ENDPOINTS');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-F01', 'analytics', 'GET /api/v1/stats/by-object returns aggregations', async () => {
    const r = await rest('GET', '/api/v1/stats/by-object');
    assertEqual(r.status, 200, 'HTTP 200');
    assert(Array.isArray(r.json?.data), 'data array');
    const ours = r.json.data.find(d => d.object_name === `${TEST_MARKER}-rest-A`);
    assert(ours, 'aggregation row for our test object');
  });

  await tc('TC-F02', 'analytics', 'GET /api/v1/stats/trend returns daily breakdown', async () => {
    const r = await rest('GET', '/api/v1/stats/trend');
    assertEqual(r.status, 200, 'HTTP 200');
    assert(Array.isArray(r.json?.data), 'data array');
    assert(r.json.data.length > 0, 'should have at least 1 day');
  });

  await tc('TC-F03', 'analytics', 'GET /api/v1/stats/recent returns last 100 rows', async () => {
    const r = await rest('GET', '/api/v1/stats/recent');
    assertEqual(r.status, 200, 'HTTP 200');
    assert(Array.isArray(r.json?.data), 'data array');
    assert(r.json.data.length <= 100, 'capped at 100');
  });

  // ─────────────────────────────────────────────────────────────────
  header('G. PENDING NAMING FLOW');
  // ─────────────────────────────────────────────────────────────────

  let pendingId = null;

  await tc('TC-G01', 'pending', 'POST /api/pending creates entry', async () => {
    const r = await rest('POST', '/api/pending', { L_mm: 77.7, W_mm: 33.3 });
    assertEqual(r.status, 201, 'HTTP 201');
    assert(typeof r.json?.id === 'number', 'id assigned');
    pendingId = r.json.id;
  });

  await tc('TC-G02', 'pending', 'POST /api/pending/:id/name sets name', async () => {
    const r = await rest('POST', `/api/pending/${pendingId}/name`, {
      name: `${TEST_MARKER}-pending`
    });
    assertEqual(r.status, 200, 'HTTP 200');
    assertEqual(r.json?.data?.name, `${TEST_MARKER}-pending`, 'name set');
  });

  await tc('TC-G03', 'pending', 'POST same name twice rejects (409 Conflict)', async () => {
    const r = await rest('POST', `/api/pending/${pendingId}/name`, { name: 'second' });
    assertEqual(r.status, 409, 'expected 409 Conflict');
  });

  // ─────────────────────────────────────────────────────────────────
  header('H. CLEANUP & CONSISTENCY');
  // ─────────────────────────────────────────────────────────────────

  await tc('TC-H01', 'cleanup', 'Direct PG DELETE removes test rows', async () => {
    const r = await pgPool.query(
      `DELETE FROM inspections WHERE object_name LIKE $1`,
      [`${TEST_MARKER}%`]);
    assert(r.rowCount >= 2, `expected >= 2 deletions, got ${r.rowCount}`);
  });

  await tc('TC-H02', 'cleanup', 'JSON sync state matches PG after PG DELETE', async () => {
    // v2.2.0: PG DELETE di TC-H01 → trigger NOTIFY → listener replicate ke JSON.
    // Wait propagation selesai (28+ NOTIFY events serial), lalu verify konsistensi.
    await new Promise(r => setTimeout(r, 1500));
    const jsonPath = path.join(__dirname, '..', 'data', 'inspections.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const remaining = data.filter(d => d.object_name?.startsWith(TEST_MARKER));
    assertEqual(remaining.length, 0, `expected 0 test rows in JSON after PG DELETE sync, got ${remaining.length}`);
  });

  // ═════════════════════════════════════════════════════════════════
  //  REPORT
  // ═════════════════════════════════════════════════════════════════
  printSummary();
  await saveMarkdownReport();

  await pgPool.end();
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
}

// ── Reporting ─────────────────────────────────────────────────────────
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
  console.log(`${C.cyan}${C.bold}║  SQA SUMMARY REPORT                                              ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}╠══════════════════════════════════════════════════════════════════╣${C.reset}`);
  const padLine = (s) => `${C.cyan}║${C.reset}  ${s}`.padEnd(75) + `${C.cyan}║${C.reset}`;
  console.log(padLine(`Total tests   : ${total}`));
  console.log(padLine(`Passed        : ${C.green}${passed}${C.reset}`));
  console.log(padLine(`Failed        : ${failed === 0 ? C.green : C.red}${failed}${C.reset}`));
  console.log(padLine(`Total duration: ${totalMs}ms`));
  console.log(padLine(`Pass rate     : ${((passed/total)*100).toFixed(1)}%`));
  console.log(padLine(`Verdict       : ${verdict}`));
  console.log(`${C.cyan}${C.bold}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);

  // Category breakdown
  const byCat = {};
  for (const r of results) {
    if (!byCat[r.category]) byCat[r.category] = { pass: 0, fail: 0 };
    byCat[r.category][r.status === 'PASS' ? 'pass' : 'fail']++;
  }
  console.log(`\n${C.bold}Category Breakdown:${C.reset}`);
  for (const [cat, c] of Object.entries(byCat)) {
    const total = c.pass + c.fail;
    const ok = c.fail === 0;
    console.log(`  ${ok ? C.green + '✓' : C.red + '✗'}${C.reset}  ${cat.padEnd(20)} ${c.pass}/${total} passed`);
  }

  if (failed > 0) {
    console.log(`\n${C.red}${C.bold}Failed tests:${C.reset}`);
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  ${C.red}✗ ${r.id}${C.reset}  ${r.description}`);
      console.log(`    ${C.dim}└─ ${r.error}${C.reset}`);
    }
  }
}

// ── Environment metadata helpers ──────────────────────────────────────
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
  try {
    const r = await pgPool.query('SHOW server_version');
    return r.rows[0].server_version;
  } catch { return 'unknown'; }
}

async function gatherEnvironment() {
  return {
    project_version: loadProjectVersion(),
    git_branch:      safeExec('git rev-parse --abbrev-ref HEAD'),
    git_commit:      safeExec('git rev-parse --short HEAD'),
    git_dirty:       safeExec('git status --porcelain') ? 'YES (uncommitted changes)' : 'NO',
    node_version:    process.version,
    npm_version:     safeExec('npm --version'),
    pg_version:      await loadPgVersion(),
    os_type:         os.type(),
    os_release:      os.release(),
    os_platform:     os.platform(),
    os_arch:         os.arch(),
    cpu_model:       os.cpus()[0]?.model || 'unknown',
    cpu_cores:       os.cpus().length,
    total_memory_gb: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
    hostname:        os.hostname(),
    user:            os.userInfo().username,
    pg_host:         process.env.PG_HOST || 'localhost',
    pg_database:     process.env.PG_DATABASE || 'capstone',
    pg_user:         process.env.PG_USER || 'postgres',
    server_port:     process.env.PORT || '3000',
  };
}

async function saveMarkdownReport() {
  const total  = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = total - passed;
  const totalMs = results.reduce((a, r) => a + r.ms, 0);
  const passRate = ((passed / total) * 100).toFixed(1);
  const runEndTime = new Date();
  const wallClockMs = runEndTime - RUN_START_TIME;
  const env = await gatherEnvironment();

  const verdict = failed === 0
    ? '✅ **ALL TESTS PASSED — APPROVED FOR RELEASE**'
    : `❌ **${failed} TEST(S) FAILED — BLOCKED**`;

  let md = '';
  md += `# SQA Test Report — ${PROJECT.name} v${env.project_version}\n\n`;
  md += `> ${verdict}\n\n`;

  // ───── Document Metadata ─────
  md += `## 📄 Document Metadata\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Document ID | \`${TEST_PLAN.document_id}\` |\n`;
  md += `| Revision | ${TEST_PLAN.revision} |\n`;
  md += `| Generated | ${runEndTime.toISOString()} |\n`;
  md += `| Generated (local) | ${runEndTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB |\n`;
  md += `| Run started | ${RUN_START_TIME.toISOString()} |\n`;
  md += `| Wall-clock duration | ${wallClockMs}ms |\n\n`;

  // ───── Tester ─────
  md += `## 👤 Tester / Author\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Name | **${TESTER.name}** |\n`;
  md += `| Email | ${TESTER.email} |\n`;
  md += `| Affiliation | ${TESTER.affiliation} |\n\n`;

  // ───── Project Under Test ─────
  md += `## 🎯 Project Under Test\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Project | ${PROJECT.name} |\n`;
  md += `| Version | \`v${env.project_version}\` |\n`;
  md += `| Module | ${PROJECT.module} |\n`;
  md += `| Repository | <${PROJECT.repository}> |\n`;
  md += `| Git branch | \`${env.git_branch}\` |\n`;
  md += `| Git commit | \`${env.git_commit}\` |\n`;
  md += `| Working tree dirty | ${env.git_dirty} |\n\n`;

  // ───── Test Plan ─────
  md += `## 📋 Test Plan\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Test level | ${TEST_PLAN.test_level} |\n`;
  md += `| Test strategy | ${TEST_PLAN.test_strategy} |\n`;
  md += `| Pass criteria | ${TEST_PLAN.pass_criteria} |\n`;
  md += `| Total test cases | ${total} |\n\n`;

  // ───── Environment ─────
  md += `## 🖥 Test Environment\n\n`;
  md += `### System\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Hostname | \`${env.hostname}\` |\n`;
  md += `| User | \`${env.user}\` |\n`;
  md += `| OS | ${env.os_type} ${env.os_release} (${env.os_platform}/${env.os_arch}) |\n`;
  md += `| CPU | ${env.cpu_model} × ${env.cpu_cores} cores |\n`;
  md += `| Memory | ${env.total_memory_gb} GB |\n\n`;

  md += `### Runtime\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Node.js | ${env.node_version} |\n`;
  md += `| npm | ${env.npm_version} |\n`;
  md += `| PostgreSQL | ${env.pg_version} |\n\n`;

  md += `### Targets\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| REST endpoint | ${REST_BASE} |\n`;
  md += `| WebSocket endpoint | ${WS_URL} |\n`;
  md += `| PG host | \`${env.pg_host}:${process.env.PG_PORT || '5432'}\` |\n`;
  md += `| PG database | \`${env.pg_database}\` |\n`;
  md += `| PG user | \`${env.pg_user}\` |\n`;
  md += `| Server port | \`${env.server_port}\` |\n\n`;

  md += `---\n\n`;

  // ───── Verdict ─────
  md += `## 🏁 Verdict\n\n${verdict}\n\n`;

  // ───── Executive Summary ─────
  md += `## 📊 Executive Summary\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Total test cases | ${total} |\n`;
  md += `| Passed | **${passed}** ✅ |\n`;
  md += `| Failed | ${failed} ${failed === 0 ? '' : '❌'} |\n`;
  md += `| Pass rate | **${passRate}%** |\n`;
  md += `| Cumulative TC duration | ${totalMs}ms |\n`;
  md += `| Avg duration / TC | ${(totalMs / total).toFixed(1)}ms |\n`;
  md += `| Critical defects | ${failed === 0 ? '0' : 'see Failed section'} |\n`;
  md += `| Test marker prefix | \`${TEST_MARKER}\` |\n\n`;

  // ───── Category Breakdown ─────
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

  // ───── Detailed Results ─────
  md += `## 🔍 Detailed Test Results\n\n`;
  md += `| ID | Category | Description | Status | Duration |\n|---|---|---|---|---|\n`;
  for (const r of results) {
    const symbol = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    md += `| \`${r.id}\` | ${r.category} | ${r.description} | ${symbol} | ${r.ms}ms |\n`;
  }
  md += `\n`;

  // ───── Failed Details ─────
  if (failed > 0) {
    md += `## ⚠️ Failed Test Details\n\n`;
    for (const r of results.filter(r => r.status === 'FAIL')) {
      md += `### ${r.id} — ${r.description}\n\n`;
      md += `- **Category:** ${r.category}\n`;
      md += `- **Duration:** ${r.ms}ms\n`;
      md += `- **Error:**\n\n`;
      md += `\`\`\`\n${r.error}\n\`\`\`\n\n`;
    }
  }

  // ───── Sign-off ─────
  md += `---\n\n`;
  md += `## ✍️ Sign-off\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Tested by | ${TESTER.name} |\n`;
  md += `| Test execution date | ${runEndTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB |\n`;
  md += `| Recommendation | ${failed === 0 ? '**Approve for release.** All acceptance criteria met.' : '**Block release.** Resolve failing tests before promotion.'} |\n`;
  md += `| Next action | ${failed === 0 ? 'Tag release & deploy.' : 'Triage failures with engineering.'} |\n\n`;

  md += `---\n\n`;
  md += `*Hak Cipta © Capstone Topik A3 Kelompok 2, Fakultas Ilmu Komputer, Universitas Brawijaya.*\n`;
  md += `*Report generated by \`qa/test_suite.js\` — automated SQA harness.*\n`;

  const out = path.join(__dirname, 'REPORT.md');
  fs.writeFileSync(out, md);
  console.log(`\n${C.dim}Report saved to: ${out}${C.reset}`);
}

// ── Main ──────────────────────────────────────────────────────────────
runAll().catch(e => {
  console.error(`\n${C.red}${C.bold}FATAL: ${e.message}${C.reset}`);
  console.error(e.stack);
  process.exit(2);
});
