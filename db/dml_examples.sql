-- =====================================================================
--  DML Examples — Automated Dimensional Inspection (Capstone A3 Filkom UB)
--
--  File ini berisi contoh DML (INSERT/UPDATE/DELETE/SELECT) lengkap untuk
--  tabel `inspections`. Setiap perubahan otomatis memicu trigger NOTIFY
--  ke server.js → JSON file disinkronkan + dashboard terupdate real-time
--  via WebSocket (ws://localhost:3000/ws).
--
--  Cara menjalankan:
--    psql -h localhost -U postgres -d capstone -f db/dml_examples.sql
--
--  Atau interaktif (recommended untuk eksplorasi):
--    psql -h localhost -U postgres -d capstone
--    \i db/dml_examples.sql
--
--  Atau jalankan satu blok saja:
--    PGPASSWORD='Hilmy250306' /Library/PostgreSQL/18/bin/psql -h localhost \
--      -U postgres -d capstone -c "INSERT INTO inspections ..."
-- =====================================================================

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo '  DML EXAMPLES — buka dashboard http://localhost:3000 untuk lihat'
\echo '  perubahan real-time saat menjalankan setiap blok di bawah.'
\echo '═══════════════════════════════════════════════════════════════════'

-- ─────────────────────────────────────────────────────────────────────
--  PRE-CHECK: lihat state sekarang
-- ─────────────────────────────────────────────────────────────────────
\echo ''
\echo '── State awal ──'
SELECT COUNT(*) AS total_rows FROM inspections;


-- =====================================================================
--  SECTION A — INSERT
-- =====================================================================
\echo ''
\echo '═══ SECTION A: INSERT ═══'

-- ── A.1: INSERT single row dengan semua kolom ────────────────────────
INSERT INTO inspections
  (id, object_name, dimension_mm, width_mm, confidence, status, "timestamp")
VALUES
  (10001, 'Demo KTP', 85.62, 53.98, 0.96, 'OK', NOW());

\echo '  A.1: 1 row inserted (Demo KTP)'

-- ── A.2: INSERT minimal (kolom optional NULL) ────────────────────────
INSERT INTO inspections (id, dimension_mm, status)
VALUES (10002, 25.50, 'OK');

\echo '  A.2: 1 row inserted (minimal — object_name NULL)'

-- ── A.3: INSERT bulk (multiple rows, satu statement) ─────────────────
INSERT INTO inspections
  (id, object_name, dimension_mm, width_mm, confidence, status)
VALUES
  (10010, 'Botol Air Mineral 600ml', 220.00,  65.40, 0.93, 'OK'),
  (10011, 'Botol Air Mineral 1.5L',  315.00,  85.00, 0.91, 'OK'),
  (10012, 'Pulpen Standard',         145.20,  11.80, 0.92, 'OK'),
  (10013, 'Pulpen Pilot G2',         147.00,  12.50, 0.94, 'OK'),
  (10014, 'Spidol Whiteboard',       138.20,  16.40, 0.93, 'OK'),
  (10015, 'Penggaris 30cm',          300.00,  35.00, 0.95, 'OK'),
  (10016, 'Penggaris 15cm',          150.00,  35.00, 0.96, 'OK'),
  (10017, 'Penghapus Stedler',        35.50,  22.10, 0.95, 'OK'),
  (10018, 'Buku Tulis A5',           210.00, 148.00, 0.94, 'OK'),
  (10019, 'Buku Tulis A4',           297.00, 210.00, 0.97, 'OK');

\echo '  A.3: 10 rows inserted (alat tulis & botol)'

-- ── A.4: INSERT dengan timestamp masa lalu (untuk uji trend chart) ──
INSERT INTO inspections
  (id, object_name, dimension_mm, width_mm, status, "timestamp")
VALUES
  (10020, 'Tutup Panci',     220.40, 220.10, 'OK', NOW() - INTERVAL '2 days'),
  (10021, 'Mug Keramik',      95.00,  88.50, 'NG', NOW() - INTERVAL '1 day'),
  (10022, 'Piring Makan',    250.00, 248.30, 'OK', NOW() - INTERVAL '3 hours'),
  (10023, 'Sendok Stainless',175.30,  38.20, 'OK', NOW() - INTERVAL '1 hour'),
  (10024, 'Garpu Stainless', 175.10,  27.40, 'OK', NOW() - INTERVAL '30 minutes');

\echo '  A.4: 5 rows inserted dengan timestamp masa lalu (untuk trend)'

-- ── A.5: INSERT dengan ON CONFLICT (UPSERT) ──────────────────────────
-- Berguna untuk re-run script tanpa error duplikat.
INSERT INTO inspections (id, object_name, dimension_mm, width_mm, status)
VALUES (10030, 'USB Flashdisk 32GB', 56.20, 18.50, 'OK')
ON CONFLICT (id) DO UPDATE SET
  object_name  = EXCLUDED.object_name,
  dimension_mm = EXCLUDED.dimension_mm,
  width_mm     = EXCLUDED.width_mm,
  status       = EXCLUDED.status,
  "timestamp"  = NOW();

\echo '  A.5: 1 row UPSERTed (id=10030, USB Flashdisk)'

\echo ''
\echo '── State setelah INSERT ──'
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status='OK') AS ok_count,
  COUNT(*) FILTER (WHERE status='NG') AS ng_count
FROM inspections
WHERE id BETWEEN 10000 AND 10999;


-- =====================================================================
--  SECTION B — UPDATE
-- =====================================================================
\echo ''
\echo '═══ SECTION B: UPDATE ═══'

-- ── B.1: Point update — ubah status satu row ──────────────────────────
UPDATE inspections
SET status = 'NG'
WHERE id = 10010;

\echo '  B.1: 1 row updated (id=10010 → NG)'

-- ── B.2: Update banyak field sekaligus ────────────────────────────────
UPDATE inspections
SET
  dimension_mm = 86.00,
  width_mm     = 54.00,
  confidence   = 0.99,
  "timestamp"  = NOW()
WHERE id = 10001;

\echo '  B.2: 1 row updated (id=10001 — re-measured)'

-- ── B.3: Conditional batch update — semua "Pulpen *" jadi confidence 0.95+ ─
UPDATE inspections
SET confidence = 0.95
WHERE object_name LIKE 'Pulpen%' AND confidence < 0.95;

\echo '  B.3: batch update — confidence Pulpen min 0.95'

-- ── B.4: Increment-style update (mis. catat re-test counter di field hipotetis) ──
-- Contoh kalau ada kolom retry_count INTEGER (skip karena schema kita gak punya):
-- UPDATE inspections SET retry_count = retry_count + 1 WHERE id = 10001;

-- ── B.5: Update dengan subquery ──────────────────────────────────────
-- Mis: tandai row dengan deviasi >5% dari standar KTP (85.6mm) sebagai NG
UPDATE inspections
SET status = 'NG'
WHERE object_name = 'Demo KTP'
  AND ABS(dimension_mm - 85.6) > 5.0;

\echo '  B.5: conditional flag — outlier KTP → NG'

-- ── B.6: UPDATE dengan RETURNING (lihat yang berubah) ────────────────
UPDATE inspections
SET confidence = 0.97
WHERE object_name LIKE 'Buku Tulis%'
RETURNING id, object_name, confidence;


-- =====================================================================
--  SECTION C — DELETE
-- =====================================================================
\echo ''
\echo '═══ SECTION C: DELETE ═══'

-- ── C.1: Delete by id (paling umum) ───────────────────────────────────
DELETE FROM inspections WHERE id = 10002;
\echo '  C.1: 1 row deleted (id=10002)'

-- ── C.2: Delete by name pattern ──────────────────────────────────────
DELETE FROM inspections WHERE object_name = 'Demo KTP';
\echo '  C.2: row(s) deleted (name=Demo KTP)'

-- ── C.3: Delete conditional — hapus semua NG ──────────────────────────
-- DELETE FROM inspections WHERE status = 'NG';
-- (Comment-out — hapus tanda comment kalau benar-benar mau)

-- ── C.4: Delete dengan RETURNING ──────────────────────────────────────
DELETE FROM inspections
WHERE object_name LIKE 'Penggaris%'
RETURNING id, object_name;

-- ── C.5: Delete usia tertentu (mis. row > 30 hari) ────────────────────
-- DELETE FROM inspections WHERE "timestamp" < NOW() - INTERVAL '30 days';

\echo ''
\echo '── State setelah DELETE ──'
SELECT COUNT(*) AS total_rows FROM inspections WHERE id BETWEEN 10000 AND 10999;


-- =====================================================================
--  SECTION D — SELECT (READ)
-- =====================================================================
\echo ''
\echo '═══ SECTION D: SELECT ═══'

-- ── D.1: Semua row terbaru (10 row) ──────────────────────────────────
\echo ''
\echo '── D.1: 10 row terbaru ──'
SELECT id, object_name, dimension_mm, status, "timestamp"
FROM inspections
ORDER BY "timestamp" DESC
LIMIT 10;

-- ── D.2: Filter status NG saja ────────────────────────────────────────
\echo ''
\echo '── D.2: Hanya status NG ──'
SELECT id, object_name, dimension_mm, width_mm, "timestamp"
FROM inspections
WHERE status = 'NG'
ORDER BY "timestamp" DESC;

-- ── D.3: Cari objek dengan dimensi tertentu ──────────────────────────
\echo ''
\echo '── D.3: Objek antara 100-200mm ──'
SELECT object_name, dimension_mm, status
FROM inspections
WHERE dimension_mm BETWEEN 100 AND 200
ORDER BY dimension_mm;

-- ── D.4: Aggregate — total per objek ─────────────────────────────────
\echo ''
\echo '── D.4: Total inspeksi per objek ──'
SELECT object_name, COUNT(*) AS total
FROM inspections
WHERE object_name IS NOT NULL
GROUP BY object_name
ORDER BY total DESC, object_name;

-- ── D.5: View v_inspection_summary (pass rate) ───────────────────────
\echo ''
\echo '── D.5: Pass rate per objek (view v_inspection_summary) ──'
SELECT * FROM v_inspection_summary LIMIT 10;

-- ── D.6: View v_inspection_daily_trend ───────────────────────────────
\echo ''
\echo '── D.6: Tren per hari ──'
SELECT * FROM v_inspection_daily_trend LIMIT 7;

-- ── D.7: Query dengan window function — running average dimension ────
\echo ''
\echo '── D.7: Running average dimension per object (window function) ──'
SELECT
  id,
  object_name,
  dimension_mm,
  ROUND(AVG(dimension_mm) OVER (
    PARTITION BY object_name
    ORDER BY "timestamp"
    ROWS BETWEEN 4 PRECEDING AND CURRENT ROW
  )::numeric, 2) AS rolling_avg_5
FROM inspections
WHERE object_name IS NOT NULL
ORDER BY object_name, "timestamp" DESC
LIMIT 15;

-- ── D.8: Query analytics — outlier detection ─────────────────────────
\echo ''
\echo '── D.8: Outlier (deviasi > 2σ dari mean per objek) ──'
WITH stats AS (
  SELECT
    object_name,
    AVG(dimension_mm) AS mu,
    STDDEV_SAMP(dimension_mm) AS sigma
  FROM inspections
  WHERE object_name IS NOT NULL
  GROUP BY object_name
  HAVING COUNT(*) >= 3
)
SELECT
  i.id,
  i.object_name,
  i.dimension_mm,
  ROUND(s.mu::numeric, 2)    AS mean,
  ROUND(s.sigma::numeric, 2) AS stddev,
  ROUND((ABS(i.dimension_mm - s.mu) / NULLIF(s.sigma, 0))::numeric, 2) AS z_score
FROM inspections i
JOIN stats s USING (object_name)
WHERE ABS(i.dimension_mm - s.mu) > 2 * s.sigma
ORDER BY z_score DESC NULLS LAST;


-- =====================================================================
--  SECTION E — STRESS TEST (opsional — bulk insert 100 row)
-- =====================================================================
\echo ''
\echo '═══ SECTION E: STRESS TEST (opsional, comment kalau gak mau) ═══'

-- ── E.1: Bulk insert 100 row dengan generate_series ──────────────────
-- INSERT INTO inspections (id, object_name, dimension_mm, width_mm, confidence, status)
-- SELECT
--   20000 + n,
--   'Stress-Test-' || n,
--   ROUND((50 + RANDOM() * 200)::numeric, 2)::double precision,
--   ROUND((20 + RANDOM() * 80)::numeric, 2)::double precision,
--   ROUND((0.7 + RANDOM() * 0.3)::numeric, 2)::double precision,
--   CASE WHEN RANDOM() > 0.2 THEN 'OK' ELSE 'NG' END
-- FROM generate_series(1, 100) n;
-- \echo '  E.1: 100 stress-test rows inserted'

-- Hapus tanda -- di awal baris di atas kalau benar-benar mau jalan.
\echo '  (E.1 di-comment — uncomment manual untuk stress test)'


-- =====================================================================
--  SECTION F — CLEANUP (hapus row demo)
-- =====================================================================
\echo ''
\echo '═══ SECTION F: CLEANUP ═══'

-- ── F.1: Hapus semua row demo (id 10000-10999) ───────────────────────
DELETE FROM inspections WHERE id BETWEEN 10000 AND 10999;
\echo '  F.1: row demo (id 10000-10999) dihapus'

-- ── F.2: Hapus semua stress test (id 20000-29999) ────────────────────
DELETE FROM inspections WHERE id BETWEEN 20000 AND 29999;
\echo '  F.2: row stress-test (id 20000-29999) dihapus'

-- ── F.3: TRUNCATE total — hati-hati, hapus SEMUA row ─────────────────
-- TRUNCATE TABLE inspections;
-- \echo '  F.3: TRUNCATE — semua row dihapus (uncomment manual!)'

\echo ''
\echo '── State akhir ──'
SELECT COUNT(*) AS final_rows FROM inspections;

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo '  DONE — coba refresh dashboard, semua perubahan harus sudah sync'
\echo '═══════════════════════════════════════════════════════════════════'
