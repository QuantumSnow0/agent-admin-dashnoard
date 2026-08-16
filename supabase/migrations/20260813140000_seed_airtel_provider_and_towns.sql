-- =============================================================================
-- Seed Airtel provider + 14 Installation Towns
-- =============================================================================
-- Canonical geography is untouched.
-- Operational areas remain classification logic only (no table).
--
-- This migration:
--   - upserts isp_providers where code = 'airtel'
--   - upserts the 14 Airtel Forms town buckets
--
-- This migration does NOT:
--   - insert isp_installation_locations (205 picker labels stay out)
--   - insert location_isp_mappings (1,087 town-only mappings are a later step)
--   - modify public.locations or public.location_geometries
--   - create an operational_areas table
--   - invent Forms option GUIDs or hard-coded row UUIDs
-- =============================================================================

INSERT INTO public.isp_providers (
  code,
  name,
  is_active,
  installation_town_question_id,
  delivery_landmark_question_id,
  optional_field_question_id,
  metadata
)
VALUES (
  'airtel',
  'Airtel',
  TRUE,
  'rc89257414e57426dac9a183c60a4b556',
  'r7a69684d43ec4bf1b6971b21a8b4dd18',
  'r1e3b5a91acaa465b8aab76bab2cad94a',
  '{}'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active,
  installation_town_question_id = EXCLUDED.installation_town_question_id,
  delivery_landmark_question_id = EXCLUDED.delivery_landmark_question_id,
  optional_field_question_id = EXCLUDED.optional_field_question_id,
  metadata = EXCLUDED.metadata;

INSERT INTO public.isp_installation_towns (
  provider_id,
  town_key,
  town_label,
  location_question_id,
  is_active,
  sort_order
)
SELECT
  p.id,
  v.town_key,
  v.town_label,
  v.location_question_id,
  TRUE,
  v.sort_order
FROM public.isp_providers AS p
CROSS JOIN (
  VALUES
    (1,  'BUNGOMA',  'Bungoma',  'rbf5746ac7f5e4d2cab54a1b8df24b5e1'),
    (2,  'ELDORET',  'Eldoret',  'r24b818b049314910ad025b6b727e64a3'),
    (3,  'GARISSA',  'Garissa',  'r2fc4cb930c154b5e8f1a354d4ac354a5'),
    (4,  'KAKAMEGA', 'Kakamega', 'r28f2b48873504822b4010ba668be5267'),
    (5,  'KILIFI',   'Kilifi',   'rafb9a2cdb406426fa865a66baa42b3a0'),
    (6,  'KISII',    'Kisii',    'r77cbe5ec85a8411ca451f323c9336c7e'),
    (7,  'KISUMU',   'Kisumu',   'r39626af0978948d780a63643b5a14ef7'),
    (8,  'KITALE',   'Kitale',   'rcae794cab7ff49bbacecf526f6c7f4ff'),
    (9,  'MACHAKOS', 'Machakos', 're7e1cac4a9424be9a965efd0e7065812'),
    (10, 'MERU',     'Meru',     'rd95772902dc54356bce0f3d11204586a'),
    (11, 'MIGORI',   'Migori',   'r3a023823fcfe46798b4b8af5051dc632'),
    (12, 'MOMBASA',  'Mombasa',  'r6c5bd7f72fde4c51b2ac8661f3d3afac'),
    (13, 'NAIROBI',  'Nairobi',  'r99215bf0748f4e949b127b4a344e44ec'),
    (14, 'NAKURU',   'Nakuru',   'r37c5c841668f44269a3410c03e9eb055')
) AS v(sort_order, town_key, town_label, location_question_id)
WHERE p.code = 'airtel'
ON CONFLICT (provider_id, town_key) DO UPDATE SET
  town_label = EXCLUDED.town_label,
  location_question_id = EXCLUDED.location_question_id,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;
