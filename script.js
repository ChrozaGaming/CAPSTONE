/**
 * script.js
 * Frontend logic untuk Automated Dimensional Inspection Dashboard
 *
 * Tanggung jawab:
 *  - Polling data inspeksi dari server setiap 5 detik
 *  - Menampilkan hasil terbaru, statistik, dan riwayat
 *  - Simulasi data inspeksi acak
 *  - Update Chart.js (bar chart OK vs NG)
 *  - Live clock, toast notifications, connection status
 */

'use strict';

// ─── KONFIGURASI ─────────────────────────────────────────────────────
const API_BASE       = 'http://localhost:3000';
const REFRESH_MS     = 5000;       // Auto-refresh setiap 5 detik
const PENDING_MS     = 1500;       // Polling pending lebih cepat agar form responsif
const TOLERANCE_MM   = 0.5;        // ±0.5 mm dari 10.0 mm → OK
const TARGET_MM      = 10.0;       // Nilai target dimension
const SIM_MIN        = 9.0;        // Batas bawah simulasi
const SIM_MAX        = 11.0;       // Batas atas simulasi
const MAX_TABLE_ROWS = 50;         // Batas tampilan riwayat

// ─── STATE ───────────────────────────────────────────────────────────
let inspectionChart  = null;       // Instance Chart.js
let lastId           = null;       // ID data terakhir (deteksi perubahan)
let refreshTimer     = null;       // Interval auto-refresh
let isSimulating     = false;      // Mencegah double-click
let isConnected      = false;      // Status koneksi server

// ─── INIT ─────────────────────────────────────────────────────────────
/**
 * Inisialisasi: jalankan clock, buat chart, mulai polling.
 */
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  initChart();
  fetchAndRender();                            // Pertama kali
  fetchPending();                              // Pending objek baru
  refreshTimer = setInterval(fetchAndRender, REFRESH_MS);
  setInterval(fetchPending, PENDING_MS);
});

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
 * Buat bar chart OK vs NG menggunakan Chart.js.
 */
function initChart() {
  const ctx = document.getElementById('inspectionChart').getContext('2d');

  inspectionChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['OK ✅', 'NG ❌'],
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
    renderLatestCard(data);
    renderStats(data);
    renderHistory(data);
    updateChart(
      data.filter(d => d.status === 'OK').length,
      data.filter(d => d.status === 'NG').length
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
  const isOK     = latest.status === 'OK';
  const tsFormatted = formatTimestamp(latest.timestamp);
  const objName  = latest.object_name && String(latest.object_name).trim() ? latest.object_name : 'Tanpa nama';

  // Update konten
  if (objEl) objEl.textContent = objName;
  dimEl.textContent = Number(latest.dimension_mm).toFixed(3);
  badge.innerHTML   = isOK
    ? '<span>✔ OK</span>'
    : '<span>✘ NG</span>';
  tsEl.textContent  = tsFormatted;

  // Ganti kelas warna
  card.className = `latest-card ${isOK ? 'ok' : 'ng'}${isNew ? ' new-entry' : ''}`;

  // Hapus animasi setelah selesai
  if (isNew) {
    card.addEventListener('animationend', () => card.classList.remove('new-entry'), { once: true });
    // Tampilkan toast notifikasi
    const objTag = latest.object_name ? `${latest.object_name} · ` : '';
    showToast(
      `Inspeksi #${latest.id}: ${objTag}${Number(latest.dimension_mm).toFixed(3)} mm — ${latest.status}`,
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
  const okCnt  = data.filter(d => d.status === 'OK').length;
  const ngCnt  = data.filter(d => d.status === 'NG').length;
  const pct    = total > 0 ? ((okCnt / total) * 100).toFixed(1) + '%' : '0%';

  animateCounter('stat-total', total);
  animateCounter('stat-ok',    okCnt);
  animateCounter('stat-ng',    ngCnt);
  document.getElementById('stat-pct').textContent = pct;
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
  const tbody      = document.getElementById('history-body');
  const emptyState = document.getElementById('empty-state');
  const recordCountEl = document.getElementById('record-count');

  recordCountEl.textContent = `${data.length} rekod`;

  if (!data || data.length === 0) {
    tbody.innerHTML    = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  // Batasi baris tabel agar tidak overload
  const rows = data.slice(0, MAX_TABLE_ROWS);
  const newestId = rows[0]?.id;

  tbody.innerHTML = rows.map((item, idx) => {
    const isOK    = item.status === 'OK';
    const isNewest = item.id === newestId && idx === 0;
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
            ${isOK ? '✔' : '✘'} ${item.status}
          </span>
        </td>
        <td class="td-time">${ts}</td>
      </tr>
    `;
  }).join('');
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
  const status = Math.abs(dim - TARGET_MM) <= TOLERANCE_MM ? 'OK' : 'NG';

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
