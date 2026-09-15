-- Local/SQL verification helpers for Phase 1A + 1A.1 (not applied to production).
-- Run only against a disposable database after applying migrations.

-- 1) Assigned progress cases (all ok must be true)
SELECT * FROM wam_ai.verify_assigned_progress_cases();

-- 2) Phase 1A.1: search requires filter; default limit 25
SELECT wam_ai.search_agents('Test', NULL, NULL, NULL, NULL, NULL)->>'limit' AS search_limit;
SELECT wam_ai.search_agents('Test', NULL, NULL, NULL, NULL, NULL)->>'result_count' AS agent_hits;

-- 3) Phase 1A.1: detail ambiguity (expect status ambiguous when multiple phones match)
-- SELECT wam_ai.get_lead_details(NULL, NULL, '254722000002', NULL);

-- 4) Phase 1A regression: analytics still callable
SELECT wam_ai.get_operational_summary(NULL, NULL, NULL) IS NOT NULL AS analytics_ok;
