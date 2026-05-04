/**
 * script.js
 * Frontend logic untuk Automated Dimensional Inspection Dashboard
 *
 * Tanggung jawab:
 *  - Polling data inspeksi dari server setiap 5 detik
 *  - Menampilkan hasil terbaru, statistik, dan riwayat
 *  - Simulasi data inspeksi acak
 *  - Update Chart.js (bar chart GOOD vs NOT GOOD)
 *  - Live clock, toast notifications, connection status
 */

'use strict';

// ─── KONFIGURASI ─────────────────────────────────────────────────────
const API_BASE       = 'http://localhost:3000';
const WS_URL         = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
const REFRESH_MS     = 5000;       // Auto-refresh tiap 5 detik (WS tetap push instan)
const PENDING_MS     = 1500;       // Polling pending (fallback bila WS down)
const TOLERANCE_MM   = 0.5;        // ±0.5 mm dari 10.0 mm → OK
const TARGET_MM      = 10.0;       // Nilai target dimension
const SIM_MIN        = 9.0;        // Batas bawah simulasi
const SIM_MAX        = 11.0;       // Batas atas simulasi

// ─── STATE ───────────────────────────────────────────────────────────
let inspectionChart  = null;       // Instance Chart.js
let lastId           = null;       // ID data terakhir (deteksi perubahan)
let refreshTimer     = null;       // Interval auto-refresh
let isSimulating     = false;      // Mencegah double-click
let isConnected      = false;      // Status koneksi REST server
let ws               = null;       // WebSocket instance
let wsBackoffMs      = 1000;       // Reconnect backoff (1s → 2s → 4s → max 30s)

// Cache data terakhir + state filter/sort/pagination per-tabel.
// Disimpan di sini supaya re-render tanpa fetch ulang ketika user mengubah filter.
const PAGE_SIZE = 10;
let latestData = [];
const historyState = {
  page: 1,
  sortKey: 'id',          // default: ID
  sortDir: 'desc',        // newest first
  search: '',
  statusFilter: 'all',    // 'all' | 'GOOD' | 'NOT GOOD'
};
const groupedState = {
  page: 1,
  sortKey: 'total',
  sortDir: 'desc',
  search: '',
};

// ─── INIT ─────────────────────────────────────────────────────────────
/**
 * Inisialisasi: jalankan clock, buat chart, mulai polling, connect WS.
 */
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  initChart();
  fetchAndRender();                            // Pertama kali (initial state)
  fetchPending();                              // Pending objek baru
  // Polling tetap jalan tapi lambat (15s) — WS handle real-time push.
  // Polling masih berguna sebagai safety net bila WS disconnect & belum reconnect.
  refreshTimer = setInterval(fetchAndRender, REFRESH_MS);
  setInterval(fetchPending, PENDING_MS);
  connectWebSocket();
});

// ─────────────────────────────────────────────────────────────────────
// 0. WEBSOCKET REAL-TIME CONNECTION
// ─────────────────────────────────────────────────────────────────────
/**
 * Connect ke /ws → terima push event dari server tanpa polling.
 * Reconnect otomatis dengan exponential backoff (1s → 30s max).
 */
function connectWebSocket() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.warn('[WS] Constructor gagal:', e.message);
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    console.log('[WS] connected');
    wsBackoffMs = 1000; // reset backoff
    setWsIndicator(true);
    // Refresh state begitu WS connect agar konsisten dengan event yang mungkin
    // datang sebelum subscribe.
    fetchAndRender();
    fetchPending();
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      handleWsEvent(msg);
    } catch (e) {
      console.warn('[WS] bad message:', e.message);
    }
  });

  ws.addEventListener('close', () => {
    console.log('[WS] disconnected — reconnect in', wsBackoffMs, 'ms');
    setWsIndicator(false);
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    setWsIndicator(false);
    // 'close' akan fire setelah 'error' → reconnect via close handler
  });
}

function scheduleReconnect() {
  setTimeout(() => {
    wsBackoffMs = Math.min(wsBackoffMs * 2, 30000);
    connectWebSocket();
  }, wsBackoffMs);
}

function handleWsEvent(msg) {
  if (!msg?.type) return;
  switch (msg.type) {
    case 'hello':
      console.log('[WS] hello — pgReady:', msg.data?.pgReady);
      break;

    case 'inspection.created':
    case 'inspection.updated':
    case 'inspection.deleted':
    case 'inspection.cleared':
      // Push instan dari WS — server.js udah sync state JSON & PG di sisinya.
      // Dashboard tinggal re-fetch supaya list, stats, chart konsisten.
      fetchAndRender();
      break;

    case 'pending.created':
    case 'pending.named':
    case 'pending.cancelled':
      // Pending list berubah → refresh form
      fetchPending();
      break;

    default:
      // Event baru di future — abaikan tanpa error
      break;
  }
}

function setWsIndicator(online) {
  const el = document.getElementById('ws-indicator');
  if (!el) return;
  el.classList.toggle('ws-online', online);
  el.classList.toggle('ws-offline', !online);
  el.title = online
    ? 'Realtime WebSocket aktif — update tanpa delay'
    : 'WebSocket offline — fallback polling 15s';
}

// ─────────────────────────────────────────────────────────────────────
// 1. LIVE CLOCK
// ─────────────────────────────────────────────────────────────────────
/**
 * Update jam dan tanggal di header setiap detik.
 */
function startClock() {
  const DAYS   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];

  function tick() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    const ss  = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('clock-time').textContent = `${hh}:${mm}:${ss}`;
    document.getElementById('clock-date').textContent =
      `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  }

  tick();
  setInterval(tick, 1000);
}

// ─────────────────────────────────────────────────────────────────────
// 2. CHART.JS INITIALIZATION
// ─────────────────────────────────────────────────────────────────────
/**
 * Buat bar chart GOOD vs NOT GOOD menggunakan Chart.js.
 */
function initChart() {
  const ctx = document.getElementById('inspectionChart').getContext('2d');

  inspectionChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['GOOD ✅', 'NOT GOOD ❌'],
      datasets: [{
        label: 'Jumlah',
        data: [0, 0],
        backgroundColor: ['rgba(16,185,129,0.25)', 'rgba(239,68,68,0.25)'],
        borderColor:      ['rgba(16,185,129,0.9)',  'rgba(239,68,68,0.9)'],
        borderWidth: 2,
        borderRadius: 8,
        hoverBackgroundColor: ['rgba(16,185,129,0.4)', 'rgba(239,68,68,0.4)'],
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a2235',
          borderColor: '#1e3a5f',
          borderWidth: 1,
          titleColor: '#f1f5f9',
          bodyColor:  '#94a3b8',
          padding: 10,
          callbacks: {
            label: ctx => ` ${ctx.parsed.y} inspeksi`
          }
        }
      },
      scales: {
        x: {
          grid:  { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#94a3b8', font: { family: 'Inter', size: 12 } }
        },
        y: {
          beginAtZero: true,
          grid:  { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Inter', size: 11 },
            stepSize: 1,
            precision: 0
          }
        }
      },
      animation: { duration: 400, easing: 'easeInOutQuart' }
    }
  });
}

/**
 * Perbarui data chart.
 * @param {number} okCount
 * @param {number} ngCount
 */
function updateChart(okCount, ngCount) {
  if (!inspectionChart) return;
  inspectionChart.data.datasets[0].data = [okCount, ngCount];
  inspectionChart.update();
}

// ─────────────────────────────────────────────────────────────────────
// 3. FETCH & RENDER
// ─────────────────────────────────────────────────────────────────────
/**
 * Ambil data dari server, lalu render semua komponen UI.
 */
async function fetchAndRender() {
  try {
    const response = await fetch(`${API_BASE}/inspection`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();
    const data = json.data; // Array sudah diurutkan terbaru di atas

    setConnectionStatus(true);
    latestData = Array.isArray(data) ? data : [];
    renderLatestCard(latestData);
    renderStats(latestData);
    renderHistory(latestData);
    renderGrouped(latestData);
    updateChart(
      latestData.filter(d => d.status === 'GOOD').length,
      latestData.filter(d => d.status === 'NOT GOOD').length
    );

  } catch (err) {
    setConnectionStatus(false);
    console.warn('Gagal fetch data:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 4. CONNECTION STATUS
// ─────────────────────────────────────────────────────────────────────
function setConnectionStatus(connected) {
  const bar  = document.getElementById('connection-status');
  const text = document.getElementById('conn-text');
  const icon = document.getElementById('conn-icon');

  if (connected && !isConnected) {
    showToast('Terhubung ke server ✓', 'info');
  } else if (!connected && isConnected) {
    showToast('Koneksi terputus — mencoba ulang…', 'error');
  }

  isConnected = connected;
  bar.className = `connection-bar ${connected ? 'connected' : 'disconnected'}`;
  icon.textContent = '⬤';
  text.textContent = connected
    ? `Server terhubung · Auto-refresh setiap ${REFRESH_MS/1000}s`
    : 'Tidak dapat terhubung ke server — pastikan server.js berjalan';
}

// ─────────────────────────────────────────────────────────────────────
// 5. RENDER: LATEST CARD
// ─────────────────────────────────────────────────────────────────────
/**
 * Tampilkan kartu hasil inspeksi terbaru.
 * @param {Array} data
 */
function renderLatestCard(data) {
  const card   = document.getElementById('latest-card');
  const dimEl  = document.getElementById('latest-dim');
  const badge  = document.getElementById('latest-badge');
  const tsEl   = document.getElementById('latest-ts');
  const objEl  = document.getElementById('latest-objname');

  if (!data || data.length === 0) {
    card.className = 'latest-card idle';
    if (objEl) objEl.textContent = '—';
    dimEl.textContent  = '—';
    badge.innerHTML    = '<span>MENUNGGU DATA</span>';
    tsEl.textContent   = 'Belum ada data';
    lastId = null;
    return;
  }

  const latest   = data[0];   // Data terbaru ada di indeks 0
  const isNew    = latest.id !== lastId;
  const isOK     = latest.status === 'GOOD';
  const tsFormatted = formatTimestamp(latest.timestamp);
  const objName  = latest.object_name && String(latest.object_name).trim() ? latest.object_name : 'Tanpa nama';

  // Update konten
  if (objEl) objEl.textContent = objName;
  dimEl.textContent = Number(latest.dimension_mm).toFixed(3);
  badge.innerHTML   = isOK
    ? '<span>✔ GOOD</span>'
    : '<span>✘ NOT GOOD</span>';
  tsEl.textContent  = tsFormatted;

  // Ganti kelas warna
  card.className = `latest-card ${isOK ? 'ok' : 'ng'}${isNew ? ' new-entry' : ''}`;

  // Hapus animasi setelah selesai
  if (isNew) {
    card.addEventListener('animationend', () => card.classList.remove('new-entry'), { once: true });
    // Tampilkan toast notifikasi
    const objTag = latest.object_name ? `${latest.object_name} · ` : '';
    const statusLabel = isOK ? 'GOOD' : 'NOT GOOD';
    showToast(
      `Inspeksi #${latest.id}: ${objTag}${Number(latest.dimension_mm).toFixed(3)} mm — ${statusLabel}`,
      isOK ? 'ok' : 'ng'
    );
    lastId = latest.id;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 6. RENDER: STATISTIK
// ─────────────────────────────────────────────────────────────────────
/**
 * Hitung dan tampilkan statistik OK/NG.
 * @param {Array} data
 */
function renderStats(data) {
  const total  = data.length;
  const okCnt  = data.filter(d => d.status === 'GOOD').length;
  const ngCnt  = data.filter(d => d.status === 'NOT GOOD').length;
  const goodRate = total > 0 ? ((okCnt / total) * 100).toFixed(1) + '%' : '0%';
  const ngRate   = total > 0 ? ((ngCnt / total) * 100).toFixed(1) + '%' : '0%';

  animateCounter('stat-total', total);
  animateCounter('stat-ok',    okCnt);
  animateCounter('stat-ng',    ngCnt);
  document.getElementById('stat-pct').textContent    = goodRate;
  document.getElementById('stat-ng-pct').textContent = ngRate;
}

/**
 * Animasi angka naik perlahan.
 * @param {string} id  - ID elemen
 * @param {number} target - Nilai akhir
 */
function animateCounter(id, target) {
  const el  = document.getElementById(id);
  const cur = parseInt(el.textContent) || 0;
  if (cur === target) return;

  const step = Math.ceil(Math.abs(target - cur) / 10);
  let   val  = cur;

  const timer = setInterval(() => {
    val = val < target ? Math.min(val + step, target) : Math.max(val - step, target);
    el.textContent = val;
    if (val === target) clearInterval(timer);
  }, 30);
}

// ─────────────────────────────────────────────────────────────────────
// 7. RENDER: RIWAYAT
// ─────────────────────────────────────────────────────────────────────
/**
 * Isi tabel riwayat inspeksi.
 * @param {Array} data
 */
function renderHistory(data) {
  const tbody         = document.getElementById('history-body');
  const emptyState    = document.getElementById('empty-state');
  const recordCountEl = document.getElementById('record-count');
  const filterCountEl = document.getElementById('history-count');

  recordCountEl.textContent = `${data.length} rekod`;

  // 1. Apply filter (search + status)
  const q = historyState.search.trim().toLowerCase();
  let filtered = (data || []).filter(item => {
    if (historyState.statusFilter !== 'all' && item.status !== historyState.statusFilter) return false;
    if (q) {
      const name = String(item.object_name || '').toLowerCase();
      if (!name.includes(q)) return false;
    }
    return true;
  });

  // 2. Apply sort
  filtered = sortRows(filtered, historyState.sortKey, historyState.sortDir, getSortType('history-table', historyState.sortKey));

  filterCountEl.textContent = `${filtered.length} baris`;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    renderPagination('history-pagination', historyState, 0, () => renderHistory(latestData));
    updateSortIndicators('history-table', historyState);
    return;
  }
  emptyState.style.display = 'none';

  // 3. Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (historyState.page > totalPages) historyState.page = totalPages;
  if (historyState.page < 1) historyState.page = 1;
  const start = (historyState.page - 1) * PAGE_SIZE;
  const rows  = filtered.slice(start, start + PAGE_SIZE);
  const newestId = (data && data.length) ? data[0].id : null;

  tbody.innerHTML = rows.map(item => {
    const isOK    = item.status === 'GOOD';
    const isNewest = item.id === newestId;
    const dim     = Number(item.dimension_mm).toFixed(3);
    const ts      = formatTimestamp(item.timestamp);
    const objName = item.object_name && String(item.object_name).trim() ? item.object_name : '—';

    return `
      <tr class="${isNewest ? 'newest-row' : ''}">
        <td class="td-id">#${item.id}</td>
        <td class="td-obj">${escapeHtml(objName)}</td>
        <td class="td-dim">${dim}</td>
        <td class="td-status">
          <span class="pill ${isOK ? 'ok' : 'ng'}">
            ${isOK ? '✔ GOOD' : '✘ NOT GOOD'}
          </span>
        </td>
        <td class="td-time">${ts}</td>
      </tr>
    `;
  }).join('');

  renderPagination('history-pagination', historyState, totalPages, () => renderHistory(latestData));
  updateSortIndicators('history-table', historyState);
}

// ─────────────────────────────────────────────────────────────────────
// 7b. RENDER: KLASIFIKASI PER OBJEK
// ─────────────────────────────────────────────────────────────────────
let groupedMode = true; // true = group by object_name, false = flat (semua tanpa grouping)

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-group-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    groupedMode = !groupedMode;
    btn.setAttribute('aria-pressed', String(groupedMode));
    btn.textContent = groupedMode ? 'Mode: Dikelompokkan' : 'Mode: Semua (tanpa group)';
    fetchAndRender();
  });
});

/**
 * Render klasifikasi GOOD/NOT GOOD per nama objek.
 * Dua mode:
 *  - groupedMode=true  → agregasi per object_name
 *  - groupedMode=false → satu baris per inspeksi (raw, semua tanpa group)
 */
function renderGrouped(data) {
  const tbody = document.getElementById('grouped-body');
  const empty = document.getElementById('grouped-empty');
  const countEl = document.getElementById('grouped-count');
  if (!tbody) return;

  // 1. Build base rows depending on mode
  let baseRows = [];
  if (!data || data.length === 0) {
    baseRows = [];
  } else if (groupedMode) {
    const map = new Map();
    for (const it of data) {
      const name = it.object_name && String(it.object_name).trim() ? it.object_name : '—';
      const slot = map.get(name) || { name, total: 0, good: 0, ng: 0 };
      slot.total++;
      if (it.status === 'GOOD') slot.good++;
      else if (it.status === 'NOT GOOD') slot.ng++;
      map.set(name, slot);
    }
    baseRows = Array.from(map.values()).map(s => ({
      name: s.name,
      total: s.total,
      good: s.good,
      ng: s.ng,
      goodPct: s.total > 0 ? (s.good / s.total) * 100 : 0,
      ngPct:   s.total > 0 ? (s.ng   / s.total) * 100 : 0,
    }));
  } else {
    // Flat mode: satu baris per inspeksi
    baseRows = data.map(it => {
      const name = it.object_name && String(it.object_name).trim() ? it.object_name : '—';
      const isOK = it.status === 'GOOD';
      return {
        name: `${name} #${it.id}`,
        _searchName: name,
        total: 1,
        good: isOK ? 1 : 0,
        ng:   isOK ? 0 : 1,
        goodPct: isOK ? 100 : 0,
        ngPct:   isOK ? 0   : 100,
      };
    });
  }

  // 2. Filter (search by name)
  const q = groupedState.search.trim().toLowerCase();
  let filtered = baseRows.filter(r => {
    if (!q) return true;
    const target = (r._searchName || r.name || '').toLowerCase();
    return target.includes(q);
  });

  // 3. Sort
  filtered = sortRows(filtered, groupedState.sortKey, groupedState.sortDir, getSortType('grouped-table', groupedState.sortKey));

  countEl.textContent = `${filtered.length} baris`;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    renderPagination('grouped-pagination', groupedState, 0, () => renderGrouped(latestData));
    updateSortIndicators('grouped-table', groupedState);
    return;
  }
  empty.style.display = 'none';

  // 4. Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (groupedState.page > totalPages) groupedState.page = totalPages;
  if (groupedState.page < 1) groupedState.page = 1;
  const start = (groupedState.page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = slice.map(r => {
    const goodPctTxt = r.goodPct.toFixed(1) + '%';
    const ngPctTxt   = r.ngPct.toFixed(1) + '%';
    return `
      <tr>
        <td class="td-obj">${escapeHtml(r.name)}</td>
        <td class="td-num">${r.total}</td>
        <td class="td-num td-good">${r.good}</td>
        <td class="td-num td-ng">${r.ng}</td>
        <td class="td-num td-good">${goodPctTxt}</td>
        <td class="td-num td-ng">${ngPctTxt}</td>
      </tr>`;
  }).join('');

  renderPagination('grouped-pagination', groupedState, totalPages, () => renderGrouped(latestData));
  updateSortIndicators('grouped-table', groupedState);
}

/**
 * Escape HTML special chars to prevent injection from user-supplied object names.
 */
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ─────────────────────────────────────────────────────────────────────
// 7c. SORT / FILTER / PAGINATION HELPERS
// ─────────────────────────────────────────────────────────────────────

/**
 * Generic stable sort. type: 'number' | 'string' | 'date'
 * Status sort: 'GOOD' < 'NOT GOOD' (default lowercase compare sudah benar).
 */
function sortRows(rows, key, dir, type) {
  const mul = dir === 'asc' ? 1 : -1;
  const asNum  = v => (v === null || v === undefined ? -Infinity : Number(v));
  const asStr  = v => String(v ?? '').toLowerCase();
  const asDate = v => (v ? new Date(v).getTime() : 0);

  return rows.slice().sort((a, b) => {
    const av = a[key], bv = b[key];
    if (type === 'number')      return (asNum(av)  - asNum(bv))  * mul;
    if (type === 'date')        return (asDate(av) - asDate(bv)) * mul;
    return asStr(av).localeCompare(asStr(bv)) * mul;
  });
}

/** Look up data-sort-type pada TH untuk key tertentu. Default 'string'. */
function getSortType(tableId, sortKey) {
  const th = document.querySelector(`#${tableId} th[data-sort-key="${sortKey}"]`);
  return th?.dataset.sortType || 'string';
}

/** Render arrow ▲/▼ di TH yang sedang aktif sort. */
function updateSortIndicators(tableId, state) {
  const ths = document.querySelectorAll(`#${tableId} th[data-sort-key]`);
  ths.forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sortKey === state.sortKey) {
      th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

/**
 * Render kontrol pagination di container.
 * Tampilkan: « prev | range page (max 5) | next » | jump-to input
 * @param {string} containerId
 * @param {object} state - { page }
 * @param {number} totalPages
 * @param {function} rerender - dipanggil setelah page berubah
 */
function renderPagination(containerId, state, totalPages, rerender) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (totalPages <= 1) {
    // Tetap tampilkan "Halaman 1 dari 1" tapi tanpa kontrol nav agar konsisten
    el.innerHTML = totalPages === 0
      ? ''
      : `<span class="page-info">Halaman 1 dari 1</span>`;
    return;
  }

  // Sliding window of up to 5 pages around current
  const maxBtns = 5;
  let from = Math.max(1, state.page - 2);
  let to   = Math.min(totalPages, from + maxBtns - 1);
  from     = Math.max(1, to - maxBtns + 1);

  const btn = (label, target, opts = {}) => {
    const dis = opts.disabled ? 'disabled' : '';
    const act = opts.active ? 'active' : '';
    return `<button type="button" class="page-btn ${act}" data-page="${target}" ${dis} aria-label="${opts.aria || `Halaman ${target}`}">${label}</button>`;
  };

  let html = '';
  html += btn('«', 1, { disabled: state.page === 1, aria: 'Halaman pertama' });
  html += btn('‹', state.page - 1, { disabled: state.page === 1, aria: 'Halaman sebelumnya' });
  if (from > 1) html += `<span class="page-ellipsis">…</span>`;
  for (let p = from; p <= to; p++) {
    html += btn(String(p), p, { active: p === state.page });
  }
  if (to < totalPages) html += `<span class="page-ellipsis">…</span>`;
  html += btn('›', state.page + 1, { disabled: state.page === totalPages, aria: 'Halaman berikutnya' });
  html += btn('»', totalPages, { disabled: state.page === totalPages, aria: 'Halaman terakhir' });

  html += `
    <span class="page-info">Halaman ${state.page} / ${totalPages}</span>
    <span class="page-jump">
      Ke halaman:
      <input type="number" min="1" max="${totalPages}" value="${state.page}"
             class="page-input" aria-label="Lompat ke halaman tertentu" />
    </span>
  `;

  el.innerHTML = html;

  // Wire up handlers
  el.querySelectorAll('.page-btn').forEach(b => {
    b.addEventListener('click', () => {
      const target = parseInt(b.dataset.page, 10);
      if (!Number.isFinite(target)) return;
      state.page = Math.min(Math.max(1, target), totalPages);
      rerender();
    });
  });
  const input = el.querySelector('.page-input');
  if (input) {
    const apply = () => {
      const v = parseInt(input.value, 10);
      if (!Number.isFinite(v)) { input.value = state.page; return; }
      state.page = Math.min(Math.max(1, v), totalPages);
      rerender();
    };
    input.addEventListener('change', apply);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); apply(); }
    });
  }
}

/** Debounce sederhana — return function yang menunda eksekusi `fn` selama `ms` setelah panggilan terakhir. */
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Pasang sort handler pada TH dari sebuah tabel. */
function attachSortHandlers(tableId, state, rerender) {
  document.querySelectorAll(`#${tableId} th[data-sort-key]`).forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.sortKey;
      if (state.sortKey === k) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = k;
        // Default direction per type: number/date → desc, string → asc
        state.sortDir = (th.dataset.sortType === 'string') ? 'asc' : 'desc';
      }
      state.page = 1;
      rerender();
    });
  });
}

// Wire up filter/sort listeners setelah DOM siap.
document.addEventListener('DOMContentLoaded', () => {
  // History table
  const histSearch = document.getElementById('history-search');
  const histStatus = document.getElementById('history-status-filter');
  if (histSearch) {
    const onHistSearch = debounce(() => {
      historyState.search = histSearch.value;
      historyState.page = 1;
      renderHistory(latestData);
    }, 250);
    histSearch.addEventListener('input', onHistSearch);
  }
  if (histStatus) {
    histStatus.addEventListener('change', () => {
      historyState.statusFilter = histStatus.value;
      historyState.page = 1;
      renderHistory(latestData);
    });
  }
  attachSortHandlers('history-table', historyState, () => renderHistory(latestData));

  // Grouped table
  const grpSearch = document.getElementById('grouped-search');
  if (grpSearch) {
    const onGrpSearch = debounce(() => {
      groupedState.search = grpSearch.value;
      groupedState.page = 1;
      renderGrouped(latestData);
    }, 250);
    grpSearch.addEventListener('input', onGrpSearch);
  }
  attachSortHandlers('grouped-table', groupedState, () => renderGrouped(latestData));
});

// ─────────────────────────────────────────────────────────────────────
// 8. SIMULASI INSPEKSI
// ─────────────────────────────────────────────────────────────────────
/**
 * Buat satu data inspeksi acak dan kirim ke server.
 * Logika: nilai antara SIM_MIN–SIM_MAX, OK jika dalam TARGET ± TOLERANCE.
 */
async function simulateInspection() {
  if (isSimulating) return;
  isSimulating = true;

  const btn  = document.getElementById('btn-simulate');
  const icon = document.getElementById('simulate-icon');

  btn.disabled = true;
  icon.className = 'spin';
  icon.textContent = '⟳';

  // Generate nilai acak
  const dim    = parseFloat((Math.random() * (SIM_MAX - SIM_MIN) + SIM_MIN).toFixed(3));
  const status = Math.abs(dim - TARGET_MM) <= TOLERANCE_MM ? 'GOOD' : 'NOT GOOD';

  try {
    const res = await fetch(`${API_BASE}/inspection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimension_mm: dim, status })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Langsung refresh tampilan
    await fetchAndRender();

  } catch (err) {
    showToast('Gagal mengirim data — server mungkin offline', 'error');
    console.error('Simulasi gagal:', err);
  } finally {
    isSimulating = false;
    btn.disabled = false;
    icon.className = '';
    icon.textContent = '⚡';
  }
}

// ─────────────────────────────────────────────────────────────────────
// 9. HAPUS DATA
// ─────────────────────────────────────────────────────────────────────
/**
 * Hapus semua data inspeksi setelah konfirmasi.
 */
async function clearAllData() {
  if (!confirm('⚠️ Hapus SEMUA data inspeksi?\n\nAksi ini tidak dapat dibatalkan.')) return;

  try {
    const res = await fetch(`${API_BASE}/inspection`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    lastId = null;
    await fetchAndRender();
    showToast('Semua data berhasil dihapus', 'info');

  } catch (err) {
    showToast('Gagal menghapus data', 'error');
    console.error('Hapus gagal:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 10. UTILITIES
// ─────────────────────────────────────────────────────────────────────

/**
 * Format ISO timestamp ke format lokal Indonesia.
 * @param {string} isoString
 * @returns {string}
 */
function formatTimestamp(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('id-ID', {
      day:   '2-digit', month: 'short', year: 'numeric',
      hour:  '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch {
    return isoString;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 11. PENDING OBJECT NAMING (Web ↔ Edge hybrid)
// ─────────────────────────────────────────────────────────────────────
/**
 * Polling daftar pending dari server. Render section "Beri Nama" di atas
 * latest card. Saat user submit, edge yang sedang polling menerima nama
 * dan resume measurement. User juga boleh ketik di terminal — mana duluan
 * menang.
 */
async function fetchPending() {
  try {
    const res = await fetch(`${API_BASE}/api/pending`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const json = await res.json();
    renderPending(Array.isArray(json.data) ? json.data : []);
  } catch {
    // Diam saja — main polling sudah menampilkan status koneksi
  }
}

/**
 * DOM diff render dengan TYPING-AWARE GUARD.
 *
 * Lapisan perlindungan untuk masalah cursor reset saat user mengetik:
 *
 *   Layer 1 (typing guard) — kalau user sedang fokus di input pending DAN
 *   pending tsb masih ada di server (belum dinamai), SKIP render seluruhnya.
 *   Tidak ada operasi DOM yang dilakukan → tidak mungkin mengganggu ketikan.
 *
 *   Layer 2 (DOM diff) — bila tidak sedang mengetik, hanya kartu baru yang
 *   di-append, kartu lama yang hilang dari list di-remove. Kartu existing
 *   tidak pernah disentuh.
 */
function renderPending(items) {
  const section = document.getElementById('pending-section');
  const list = document.getElementById('pending-list');
  if (!section || !list) return;

  // ── Layer 1: typing guard ──
  const active = document.activeElement;
  if (active?.classList?.contains('pending-input')) {
    const focusedId = active.dataset.id;
    const stillPending = items.some(p => String(p.id) === focusedId);
    if (stillPending) {
      // User masih mengetik di pending yang masih aktif — jangan sentuh DOM
      return;
    }
  }

  if (!items.length) {
    section.hidden = true;
    list.innerHTML = '';
    return;
  }
  section.hidden = false;

  // ── Layer 2: DOM diff ──
  const incomingIds = new Set(items.map(p => String(p.id)));
  const existingCards = new Map();
  list.querySelectorAll('.pending-card').forEach(card => {
    existingCards.set(card.dataset.id, card);
  });

  // Hapus kartu yang sudah tidak pending (sudah dinamai / di-skip / kadaluarsa)
  existingCards.forEach((card, id) => {
    if (!incomingIds.has(id)) card.remove();
  });

  // Tambah kartu baru saja — JANGAN sentuh kartu yang sudah ada
  items.forEach(p => {
    const idStr = String(p.id);
    if (existingCards.has(idStr)) return;

    const card = document.createElement('div');
    card.className = 'pending-card';
    card.dataset.id = idStr;
    card.innerHTML = `
      <div class="pending-info">
        <span class="pending-id">#${p.id}</span>
        <span class="pending-dims">L = ${Number(p.L_mm).toFixed(2)} mm  ·  W = ${Number(p.W_mm).toFixed(2)} mm</span>
      </div>
      <input type="text" class="pending-input" data-id="${p.id}" maxlength="60"
             placeholder="Nama objek (mis. KTP, Botol Kecap, Spidol)…"
             aria-label="Nama untuk objek pending #${p.id}"
             onkeydown="if(event.key==='Enter'){event.preventDefault();submitPendingName(${p.id});}">
      <div class="pending-actions">
        <button type="button" class="btn-save" onclick="submitPendingName(${p.id})">💾 Simpan</button>
        <button type="button" class="btn-skip" onclick="skipPending(${p.id})">⏭️ Lewati</button>
      </div>
    `;
    list.appendChild(card);

    // Auto-focus kartu baru HANYA kalau tidak ada input apa pun yang aktif
    const activeNow = document.activeElement;
    if (!activeNow || (activeNow.tagName !== 'INPUT' && activeNow.tagName !== 'TEXTAREA')) {
      const inp = card.querySelector('.pending-input');
      if (inp) inp.focus();
    }
  });
}

async function submitPendingName(id) {
  const inp = document.querySelector(`.pending-input[data-id="${id}"]`);
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) {
    showToast('Nama tidak boleh kosong', 'error');
    inp.focus();
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/pending/${id}/name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    showToast(`Objek #${id} dinamai: ${name}`, 'ok');
    fetchPending();
  } catch (e) {
    showToast(`Gagal menyimpan nama: ${e.message}`, 'error');
  }
}

async function skipPending(id) {
  try {
    const res = await fetch(`${API_BASE}/api/pending/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast(`Objek #${id} dilewati`, 'info');
    fetchPending();
  } catch (e) {
    showToast(`Gagal melewati: ${e.message}`, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────
// 12. UTILITIES (lanjutan)
// ─────────────────────────────────────────────────────────────────────

/**
 * Tampilkan toast notifikasi di pojok kanan bawah.
 * @param {string} message
 * @param {'ok'|'ng'|'info'|'error'} type
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');

  const icons = { ok: '✅', ng: '❌', info: 'ℹ️', error: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || '•'}</span><span>${message}</span>`;

  container.appendChild(toast);

  // Hapus toast setelah animasi selesai (~2.8 detik)
  setTimeout(() => toast.remove(), 2900);
}
