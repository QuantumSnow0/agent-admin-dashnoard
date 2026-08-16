-- =============================================================================
-- Airtel mapped-locations catalog view
-- =============================================================================
-- Read model for the server-to-server catalog API.
-- Does not change canonical locations or mapping rows.
-- Service role / Edge Functions query this view; it is not granted to anon.
-- =============================================================================

CREATE OR REPLACE VIEW public.airtel_mapped_locations AS
SELECT
  l.id,
  l.province,
  l.district,
  l.division,
  l.name,
  l.display_label,
  l.slug,
  t.town_key,
  t.town_label,
  t.location_question_id,
  t.sort_order AS town_sort_order,
  m.notes AS mapping_notes
FROM public.location_isp_mappings AS m
JOIN public.locations AS l
  ON l.id = m.location_id
JOIN public.isp_providers AS p
  ON p.id = m.provider_id
JOIN public.isp_installation_towns AS t
  ON t.id = m.isp_town_id
WHERE p.code = 'airtel'
  AND l.is_active = TRUE
  AND t.is_active = TRUE
  AND p.is_active = TRUE;

COMMENT ON VIEW public.airtel_mapped_locations IS
  'Resolved Airtel catalog: canonical location + Installation Town. Uncovered locations are omitted.';

REVOKE ALL ON public.airtel_mapped_locations FROM PUBLIC;
REVOKE ALL ON public.airtel_mapped_locations FROM anon;
REVOKE ALL ON public.airtel_mapped_locations FROM authenticated;
GRANT SELECT ON public.airtel_mapped_locations TO service_role;
