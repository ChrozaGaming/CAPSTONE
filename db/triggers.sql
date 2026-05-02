-- =====================================================================
--  Bidirectional Sync Triggers — PG ↔ server.js ↔ JSON
--
--  Apply: psql -h localhost -U postgres -d capstone -f db/triggers.sql
--
--  Setiap perubahan di tabel `inspections` (INSERT/UPDATE/DELETE/TRUNCATE)
--  memicu pg_notify ke channel `inspection_change` dengan payload JSON
--  berisi operasi + id + row data. Server.js LISTEN ke channel tsb dan
--  mereplikasi perubahan ke JSON file + broadcast WebSocket.
--
--  Pola ini bekerja apa pun sumber perubahannya:
--    - REST POST /inspection      → server INSERT → trigger fires → JSON updated
--    - psql / external INSERT     → trigger fires → server gets NOTIFY → JSON updated
--    - DELETE FROM ...            → trigger fires → server removes from JSON
--    - TRUNCATE TABLE inspections → statement-level trigger → JSON cleared
--
--  Idempotent: aman re-run.
-- =====================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────
--  Function: notify on INSERT / UPDATE / DELETE (per row)
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_inspection_change()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    payload := json_build_object(
      'op',   'DELETE',
      'id',   OLD.id,
      'data', row_to_json(OLD)
    );
    PERFORM pg_notify('inspection_change', payload::text);
    RETURN OLD;
  ELSE
    payload := json_build_object(
      'op',   TG_OP,           -- 'INSERT' atau 'UPDATE'
      'id',   NEW.id,
      'data', row_to_json(NEW)
    );
    PERFORM pg_notify('inspection_change', payload::text);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inspection_change_trigger ON inspections;
CREATE TRIGGER inspection_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON inspections
  FOR EACH ROW
  EXECUTE FUNCTION notify_inspection_change();

-- ──────────────────────────────────────────────────────────────────────
--  Function: notify on TRUNCATE (statement-level)
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_inspection_truncate()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('inspection_change',
    json_build_object('op', 'TRUNCATE')::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inspection_truncate_trigger ON inspections;
CREATE TRIGGER inspection_truncate_trigger
  AFTER TRUNCATE ON inspections
  FOR EACH STATEMENT
  EXECUTE FUNCTION notify_inspection_truncate();

COMMIT;

\echo '✓ Triggers installed — channel: inspection_change'
\echo '  Test: SELECT pg_notify(''inspection_change'', ''{"op":"TEST"}''::text);'
