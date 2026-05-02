-- =====================================================================
--  Sample Seed Data — for verifying schema & analytics queries
--  Capstone A3 Kelompok 2 · Filkom UB
--
--  Apply : psql -h localhost -U postgres -d capstone -f db/seed_sample.sql
--  Reset : TRUNCATE TABLE inspections; (lalu re-seed bila perlu)
--
--  Catatan:
--   - Ini hanya untuk smoke test / demo. Production data datang dari
--     edge_camera.py via server.js dual-write.
--   - Aman dijalankan ulang: ON CONFLICT DO UPDATE (idempotent).
--   - Timestamp pakai NOW() - INTERVAL agar sebaran tanggal terlihat
--     di view daily-trend.
-- =====================================================================

BEGIN;

INSERT INTO inspections
    (id, object_name, dimension_mm, width_mm, confidence, status, "timestamp")
VALUES
    -- KTP — referensi standar 85.6 × 53.98 mm
    (1, 'KTP',           85.62, 53.98, 0.96, 'OK', NOW() - INTERVAL '4 days'),
    (2, 'KTP',           85.71, 54.05, 0.94, 'OK', NOW() - INTERVAL '3 days 5 hours'),
    (3, 'KTP',           85.55, 53.91, 0.95, 'OK', NOW() - INTERVAL '3 days 1 hour'),
    (4, 'KTP',           87.14, 53.80, 0.88, 'NG', NOW() - INTERVAL '2 days'),
    (5, 'KTP',           85.60, 54.00, 0.97, 'OK', NOW() - INTERVAL '1 day 8 hours'),

    -- Botol Kecap — toleransi ±2mm
    (6, 'Botol Kecap',   62.30, 62.10, 0.91, 'OK', NOW() - INTERVAL '2 days 12 hours'),
    (7, 'Botol Kecap',   62.45, 62.20, 0.92, 'OK', NOW() - INTERVAL '1 day 22 hours'),
    (8, 'Botol Kecap',   65.10, 62.05, 0.85, 'NG', NOW() - INTERVAL '1 day 3 hours'),

    -- Tutup Panci — objek bulat besar
    (9,  'Tutup Panci',  220.40, 220.10, 0.89, 'OK', NOW() - INTERVAL '12 hours'),
    (10, 'Tutup Panci',  220.55, 220.40, 0.90, 'OK', NOW() - INTERVAL '8 hours'),
    (11, 'Tutup Panci',  225.30, 220.20, 0.78, 'NG', NOW() - INTERVAL '4 hours'),

    -- Spidol
    (12, 'Spidol',       138.20, 16.40, 0.93, 'OK', NOW() - INTERVAL '6 hours'),
    (13, 'Spidol',       138.05, 16.35, 0.94, 'OK', NOW() - INTERVAL '3 hours'),

    -- Tanpa nama (objek belum di-register)
    (14, NULL,            45.20, 28.90, 0.81, 'OK', NOW() - INTERVAL '90 minutes'),
    (15, NULL,            45.55, 29.10, 0.82, 'OK', NOW() - INTERVAL '30 minutes')
ON CONFLICT (id) DO UPDATE SET
    object_name  = EXCLUDED.object_name,
    dimension_mm = EXCLUDED.dimension_mm,
    width_mm     = EXCLUDED.width_mm,
    confidence   = EXCLUDED.confidence,
    status       = EXCLUDED.status,
    "timestamp"  = EXCLUDED."timestamp";

COMMIT;

-- ── Verification queries ──────────────────────────────────────────────
\echo ''
\echo '═══ Total rows ═══'
SELECT COUNT(*) AS total_rows FROM inspections;

\echo ''
\echo '═══ v_inspection_summary ═══'
SELECT * FROM v_inspection_summary;

\echo ''
\echo '═══ v_inspection_daily_trend ═══'
SELECT * FROM v_inspection_daily_trend;

\echo ''
\echo '═══ v_inspection_recent (top 5) ═══'
SELECT id, object_name, l_mm, w_mm, status, "timestamp"
FROM v_inspection_recent
LIMIT 5;
