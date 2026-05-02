-- =====================================================================
--  Automated Dimensional Inspection — PostgreSQL Schema
--  Capstone A3 Kelompok 2 · Filkom Universitas Brawijaya
--
--  Target  : PostgreSQL 18.x
--  Database: capstone
--  Apply   : psql -h localhost -U postgres -d capstone -f db/schema.sql
--
--  Idempotent: aman dijalankan berulang. Tidak menghapus data lama.
--  ID kolom dibiarkan INTEGER (bukan SERIAL) agar nilainya disuplai oleh
--  server.js (yang juga generate ID untuk JSON store) → JSON dan PG punya
--  row ID yang identik dan sinkron 1:1.
-- =====================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────
--  TABLE: inspections
--  Mirror persisten dari data/inspections.json.
--  Setiap row hasil pengukuran dari edge_camera.py.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspections (
    id              INTEGER          PRIMARY KEY,
    object_name     TEXT,
    dimension_mm    DOUBLE PRECISION NOT NULL,
    width_mm        DOUBLE PRECISION,
    confidence      DOUBLE PRECISION,
    status          TEXT             NOT NULL,
    "timestamp"     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT inspections_status_check
        CHECK (status IN ('OK', 'NG')),
    CONSTRAINT inspections_dim_positive
        CHECK (dimension_mm > 0),
    CONSTRAINT inspections_width_positive
        CHECK (width_mm IS NULL OR width_mm > 0),
    CONSTRAINT inspections_confidence_range
        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

COMMENT ON TABLE  inspections                IS 'Hasil pengukuran dimensi dari edge_camera.py — mirror data/inspections.json';
COMMENT ON COLUMN inspections.id             IS 'ID unik, disuplai oleh server.js (sinkron dengan JSON)';
COMMENT ON COLUMN inspections.object_name    IS 'Nama objek dari katalog (mis. KTP, Botol Kecap); NULL bila belum dinamai';
COMMENT ON COLUMN inspections.dimension_mm   IS 'Sisi panjang (L) dalam milimeter';
COMMENT ON COLUMN inspections.width_mm       IS 'Sisi pendek (W) dalam milimeter';
COMMENT ON COLUMN inspections.confidence     IS 'Skor confidence pengukuran 0–1';
COMMENT ON COLUMN inspections.status         IS 'Hasil evaluasi terhadap profil katalog: OK atau NG';
COMMENT ON COLUMN inspections."timestamp"    IS 'Waktu pengukuran (ISO 8601 dari server.js)';

-- ──────────────────────────────────────────────────────────────────────
--  INDEXES — optimasi query analitik umum
-- ──────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inspections_ts_desc
    ON inspections ("timestamp" DESC);

CREATE INDEX IF NOT EXISTS idx_inspections_object_name
    ON inspections (object_name);

CREATE INDEX IF NOT EXISTS idx_inspections_status
    ON inspections (status);

-- Composite index untuk query "stats per objek per status"
CREATE INDEX IF NOT EXISTS idx_inspections_obj_status
    ON inspections (object_name, status);

-- ──────────────────────────────────────────────────────────────────────
--  VIEW: v_inspection_summary
--  Ringkasan agregat per nama objek — pass rate, rata-rata, deviasi.
--  Pakai dari REST endpoint analytics atau langsung SELECT untuk lapor.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_inspection_summary AS
SELECT
    COALESCE(object_name, '(tanpa nama)')                AS object_name,
    COUNT(*)                                             AS total,
    SUM(CASE WHEN status = 'OK' THEN 1 ELSE 0 END)       AS ok_count,
    SUM(CASE WHEN status = 'NG' THEN 1 ELSE 0 END)       AS ng_count,
    ROUND(
        100.0 * SUM(CASE WHEN status = 'OK' THEN 1 ELSE 0 END)::numeric
              / NULLIF(COUNT(*), 0),
        2
    )                                                    AS pass_rate_pct,
    ROUND(AVG(dimension_mm)::numeric, 3)                 AS avg_l_mm,
    ROUND(STDDEV_SAMP(dimension_mm)::numeric, 3)         AS stddev_l_mm,
    ROUND(AVG(width_mm)::numeric, 3)                     AS avg_w_mm,
    ROUND(STDDEV_SAMP(width_mm)::numeric, 3)             AS stddev_w_mm,
    MIN("timestamp")                                     AS first_inspection,
    MAX("timestamp")                                     AS last_inspection
FROM inspections
GROUP BY COALESCE(object_name, '(tanpa nama)')
ORDER BY total DESC;

COMMENT ON VIEW v_inspection_summary IS
    'Ringkasan per objek: total, OK/NG count, pass rate %, rata-rata & stddev dimensi';

-- ──────────────────────────────────────────────────────────────────────
--  VIEW: v_inspection_daily_trend
--  Tren harian: jumlah pengukuran per tanggal, breakdown OK/NG.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_inspection_daily_trend AS
SELECT
    DATE("timestamp" AT TIME ZONE 'Asia/Jakarta')        AS day,
    COUNT(*)                                             AS total,
    SUM(CASE WHEN status = 'OK' THEN 1 ELSE 0 END)       AS ok_count,
    SUM(CASE WHEN status = 'NG' THEN 1 ELSE 0 END)       AS ng_count
FROM inspections
GROUP BY DATE("timestamp" AT TIME ZONE 'Asia/Jakarta')
ORDER BY day DESC;

COMMENT ON VIEW v_inspection_daily_trend IS
    'Tren pengukuran per tanggal (zona Asia/Jakarta) untuk chart line';

-- ──────────────────────────────────────────────────────────────────────
--  VIEW: v_inspection_recent
--  100 pengukuran terbaru dengan status & nama objek (untuk audit cepat).
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_inspection_recent AS
SELECT
    id,
    COALESCE(object_name, '(tanpa nama)')   AS object_name,
    dimension_mm                            AS l_mm,
    width_mm                                AS w_mm,
    confidence,
    status,
    "timestamp"
FROM inspections
ORDER BY "timestamp" DESC
LIMIT 100;

COMMENT ON VIEW v_inspection_recent IS
    '100 pengukuran terbaru — quick audit feed';

-- ──────────────────────────────────────────────────────────────────────
--  GRANTS — bila ada user analitik read-only di masa depan
--  (saat ini cuma role 'postgres' yang dipakai server.js, jadi grant
--   ini comment dulu. Aktifkan bila bikin role 'capstone_reader'.)
-- ──────────────────────────────────────────────────────────────────────
-- CREATE ROLE capstone_reader LOGIN PASSWORD 'change-me';
-- GRANT CONNECT ON DATABASE capstone TO capstone_reader;
-- GRANT USAGE   ON SCHEMA public      TO capstone_reader;
-- GRANT SELECT  ON inspections        TO capstone_reader;
-- GRANT SELECT  ON v_inspection_summary, v_inspection_daily_trend,
--                  v_inspection_recent  TO capstone_reader;

COMMIT;

\echo '✓ Schema applied — capstone.inspections siap dipakai'
