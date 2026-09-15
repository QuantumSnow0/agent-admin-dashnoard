-- Local/SQL verification helpers for Phase 1A remediation (not applied to production).
-- Run only against a disposable database after applying the reporting migration.

-- 1) Assigned progress cases (all ok must be true)
SELECT * FROM wam_ai.verify_assigned_progress_cases();

-- 2) Exact stall counts vs limited list (requires seeded data with >100 stalled rows)
-- SELECT (get_overdue_or_stalled_leads(50)->>'total_stalled_count')::int AS total,
--        jsonb_array_length(get_overdue_or_stalled_leads(50)->'leads') AS listed;
-- Expect: total can exceed listed; listed <= 50.

-- 3) Trend windows stay inside range
-- SELECT s->>'window_from', s->>'window_to'
-- FROM jsonb_array_elements(
--   wam_ai.get_registration_install_trends(
--     '2026-08-01T12:00:00Z','2026-08-03T12:00:00Z','day')->'series'
-- ) s;
-- Expect: window_from >= range_from and window_to <= range_to.
