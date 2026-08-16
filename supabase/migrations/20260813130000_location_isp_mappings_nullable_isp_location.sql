-- =============================================================================
-- Town-only ISP mappings: make isp_location_id nullable
-- =============================================================================
-- Intended relationship for this phase:
--   canonical location → ISP provider → installation town
--
-- Airtel picker labels (isp_installation_locations) are a separate future
-- mapping. Do not invent placeholder rows to satisfy a NOT NULL FK.
--
-- This migration:
--   - drops NOT NULL on location_isp_mappings.isp_location_id
--   - keeps the existing FK to isp_installation_locations(id)
--
-- This migration does NOT:
--   - seed isp_providers, isp_installation_towns, or location_isp_mappings
--   - insert isp_installation_locations
--   - modify public.locations or location_geometries
-- =============================================================================

ALTER TABLE public.location_isp_mappings
  ALTER COLUMN isp_location_id DROP NOT NULL;

COMMENT ON COLUMN public.location_isp_mappings.isp_location_id IS
  'Optional ISP picker label under the town. NULL = town-only mapping; canonical locations remain the installation geography.';

COMMENT ON TABLE public.location_isp_mappings IS
  'Canonical location → ISP provider → installation town. isp_location_id is optional until picker-label translation is designed.';
