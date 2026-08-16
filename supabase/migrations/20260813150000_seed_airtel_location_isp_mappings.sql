-- =============================================================================
-- Seed Airtel canonical location → installation town mappings
-- =============================================================================
-- Classification CASE is the finalized 13 August dry-run (Thika-inclusive).
-- Operational areas remain classification logic only (no table).
--
-- This migration:
--   - inserts 1,087 town-only rows into location_isp_mappings
--   - isp_location_id = NULL
--   - mapping_kind = 'manual'
--   - notes = 'operational_area=<area>'
--
-- This migration does NOT:
--   - modify public.locations or public.location_geometries
--   - insert isp_installation_locations
--   - map uncovered or ambiguous locations
--   - create an operational_areas table
-- =============================================================================

BEGIN;

INSERT INTO public.location_isp_mappings (
  location_id,
  provider_id,
  isp_town_id,
  isp_location_id,
  mapping_kind,
  notes
)
SELECT
  classified.id,
  p.id,
  t.id,
  NULL,
  'manual',
  'operational_area=' || classified.operational_area
FROM (
  SELECT
    l.id,
    CASE
      WHEN l.district = 'Thika'
        AND l.division = 'Ruiru'
        AND l.name IN ('Juja', 'Ruiru')
        THEN 'Kiambu'
      WHEN l.district = 'Thika'
        AND l.division = 'Gatundu South'
        AND l.name IN ('Kiamwangi', 'Kiganjo', 'Ndarugu', 'Ng''enda')
        THEN 'Kiambu'
      WHEN l.district = 'Thika'
        AND l.division = 'Kamwangi'
        AND l.name IN (
          'Gathaite', 'Githobokoni', 'Gituamba', 'Kamwangi',
          'Karuri', 'Makwa', 'Mangu'
        )
        THEN 'Kiambu'
      WHEN l.district = 'Thika'
        AND l.division = 'Thika Municipality'
        AND l.name IN ('Gatuanyaga', 'Thika')
        THEN 'Kiambu'
      WHEN l.district = 'Thika'
        AND l.division = 'Gatanga'
        AND l.name IN (
          'Gatanga', 'Kariara', 'Kigoro', 'Kihumbuini',
          'Kiriaini', 'Mugumoini', 'Mukarara'
        )
        THEN NULL
      WHEN l.district = 'Thika'
        AND l.division = 'Kakuzi'
        AND l.name IN ('Ithanga', 'Kakuzi', 'Mitubiri', 'Samuru')
        THEN NULL
      WHEN l.district = 'Thika'
        THEN '__AMBIGUOUS__'
      WHEN l.district = 'Bungoma' THEN 'Bungoma'
      WHEN l.district = 'Mt. Elgon' THEN 'Bungoma'
      WHEN l.district = 'Garissa' THEN 'Garissa'
      WHEN l.district = 'Ijara' THEN 'Garissa'
      WHEN l.district = 'Kajiado' THEN 'Kajiado'
      WHEN l.district = 'Kakamega' THEN 'Kakamega'
      WHEN l.district = 'Lugari' THEN 'Kakamega'
      WHEN l.district = 'Butere-mumias' THEN 'Kakamega'
      WHEN l.district = 'Kiambu' THEN 'Kiambu'
      WHEN l.district = 'Kilifi' THEN 'Kilifi'
      WHEN l.district = 'Malindi' THEN 'Kilifi'
      WHEN l.district = 'Kisii Central' THEN 'Kisii'
      WHEN l.district = 'Gucha (kisii South)' THEN 'Kisii'
      WHEN l.district = 'Kisumu' THEN 'Kisumu'
      WHEN l.district = 'Nyando' THEN 'Kisumu'
      WHEN l.district = 'Kwale' THEN 'Kwale'
      WHEN l.district = 'Machakos' THEN 'Machakos'
      WHEN l.district = 'Meru North' THEN 'Meru'
      WHEN l.district = 'Meru Central' THEN 'Meru'
      WHEN l.district = 'Migori' THEN 'Migori'
      WHEN l.district = 'Kuria' THEN 'Migori'
      WHEN l.district = 'Mombasa' THEN 'Mombasa'
      WHEN l.district = 'Nairobi' THEN 'Nairobi'
      WHEN l.district = 'Nakuru' THEN 'Nakuru'
      WHEN l.district = 'Kisii North (Nyamira)' THEN 'Nyamira'
      WHEN l.district = 'Meru South' THEN 'Tharaka-Nithi'
      WHEN l.district = 'Tharaka' THEN 'Tharaka-Nithi'
      WHEN l.district = 'Trans Nzoia' THEN 'Trans Nzoia'
      WHEN l.district = 'Uasin Gishu' THEN 'Uasin Gishu'
      WHEN l.district = 'West Pokot' THEN 'West Pokot'
      ELSE NULL
    END AS operational_area
  FROM public.locations AS l
) AS classified
JOIN public.isp_providers AS p
  ON p.code = 'airtel'
JOIN (
  VALUES
    ('Bungoma', 'BUNGOMA'),
    ('Garissa', 'GARISSA'),
    ('Kajiado', 'NAIROBI'),
    ('Kakamega', 'KAKAMEGA'),
    ('Kiambu', 'NAIROBI'),
    ('Kilifi', 'KILIFI'),
    ('Kisii', 'KISII'),
    ('Kisumu', 'KISUMU'),
    ('Kwale', 'MOMBASA'),
    ('Machakos', 'MACHAKOS'),
    ('Meru', 'MERU'),
    ('Migori', 'MIGORI'),
    ('Mombasa', 'MOMBASA'),
    ('Nairobi', 'NAIROBI'),
    ('Nakuru', 'NAKURU'),
    ('Nyamira', 'KISII'),
    ('Tharaka-Nithi', 'NAIROBI'),
    ('Trans Nzoia', 'KITALE'),
    ('Uasin Gishu', 'ELDORET'),
    ('West Pokot', 'KITALE')
) AS area_town(operational_area, town_key)
  ON area_town.operational_area = classified.operational_area
JOIN public.isp_installation_towns AS t
  ON t.provider_id = p.id
 AND t.town_key = area_town.town_key
WHERE classified.operational_area IS NOT NULL
  AND classified.operational_area IS DISTINCT FROM '__AMBIGUOUS__'
ON CONFLICT (location_id, provider_id) DO UPDATE SET
  isp_town_id = EXCLUDED.isp_town_id,
  mapping_kind = EXCLUDED.mapping_kind,
  notes = EXCLUDED.notes,
  updated_at = NOW();

DO $$
DECLARE
  mapping_count integer;
BEGIN
  SELECT COUNT(*)::integer
  INTO mapping_count
  FROM public.location_isp_mappings AS m
  JOIN public.isp_providers AS p ON p.id = m.provider_id
  WHERE p.code = 'airtel';

  IF mapping_count <> 1087 THEN
    RAISE EXCEPTION
      'Airtel mapping seed expected 1087 rows, found %',
      mapping_count;
  END IF;
END $$;

COMMIT;
