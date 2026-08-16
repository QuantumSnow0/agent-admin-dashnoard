-- =============================================================================
-- Post-seed validation: Airtel provider + 14 towns
-- SELECT only. Classification CASE matches the 13 August dry-run exactly.
-- =============================================================================

WITH classified AS (
  SELECT
    l.id,
    l.province,
    l.district,
    l.division,
    l.name,
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
  FROM public.locations l
),
with_town AS (
  SELECT
    classified.*,
    CASE classified.operational_area
      WHEN 'Bungoma' THEN 'BUNGOMA'
      WHEN 'Garissa' THEN 'GARISSA'
      WHEN 'Kajiado' THEN 'NAIROBI'
      WHEN 'Kakamega' THEN 'KAKAMEGA'
      WHEN 'Kiambu' THEN 'NAIROBI'
      WHEN 'Kilifi' THEN 'KILIFI'
      WHEN 'Kisii' THEN 'KISII'
      WHEN 'Kisumu' THEN 'KISUMU'
      WHEN 'Kwale' THEN 'MOMBASA'
      WHEN 'Machakos' THEN 'MACHAKOS'
      WHEN 'Meru' THEN 'MERU'
      WHEN 'Migori' THEN 'MIGORI'
      WHEN 'Mombasa' THEN 'MOMBASA'
      WHEN 'Nairobi' THEN 'NAIROBI'
      WHEN 'Nakuru' THEN 'NAKURU'
      WHEN 'Nyamira' THEN 'KISII'
      WHEN 'Tharaka-Nithi' THEN 'NAIROBI'
      WHEN 'Trans Nzoia' THEN 'KITALE'
      WHEN 'Uasin Gishu' THEN 'ELDORET'
      WHEN 'West Pokot' THEN 'KITALE'
      ELSE NULL
    END AS town_key
  FROM classified
),
expected_towns AS (
  SELECT *
  FROM (
    VALUES
      ('BUNGOMA',  'rbf5746ac7f5e4d2cab54a1b8df24b5e1'),
      ('ELDORET',  'r24b818b049314910ad025b6b727e64a3'),
      ('GARISSA',  'r2fc4cb930c154b5e8f1a354d4ac354a5'),
      ('KAKAMEGA', 'r28f2b48873504822b4010ba668be5267'),
      ('KILIFI',   'rafb9a2cdb406426fa865a66baa42b3a0'),
      ('KISII',    'r77cbe5ec85a8411ca451f323c9336c7e'),
      ('KISUMU',   'r39626af0978948d780a63643b5a14ef7'),
      ('KITALE',   'rcae794cab7ff49bbacecf526f6c7f4ff'),
      ('MACHAKOS', 're7e1cac4a9424be9a965efd0e7065812'),
      ('MERU',     'rd95772902dc54356bce0f3d11204586a'),
      ('MIGORI',   'r3a023823fcfe46798b4b8af5051dc632'),
      ('MOMBASA',  'r6c5bd7f72fde4c51b2ac8661f3d3afac'),
      ('NAIROBI',  'r99215bf0748f4e949b127b4a344e44ec'),
      ('NAKURU',   'r37c5c841668f44269a3410c03e9eb055')
  ) AS t(town_key, location_question_id)
),
airtel_towns AS (
  SELECT t.town_key, t.location_question_id, t.is_active
  FROM public.isp_installation_towns t
  JOIN public.isp_providers p ON p.id = t.provider_id
  WHERE p.code = 'airtel'
),
checks AS (
  SELECT 1 AS sort_order, 'total_locations' AS check_name, 2571 AS expected,
    (SELECT COUNT(*) FROM with_town)::int AS actual
  UNION ALL
  SELECT 2, 'mapped', 1087,
    (SELECT COUNT(*) FROM with_town WHERE town_key IS NOT NULL)::int
  UNION ALL
  SELECT 3, 'uncovered', 1484,
    (SELECT COUNT(*) FROM with_town
      WHERE town_key IS NULL
        AND operational_area IS DISTINCT FROM '__AMBIGUOUS__')::int
  UNION ALL
  SELECT 4, 'ambiguous', 0,
    (SELECT COUNT(*) FROM with_town WHERE operational_area = '__AMBIGUOUS__')::int
  UNION ALL
  SELECT 5, 'airtel_provider_count', 1,
    (SELECT COUNT(*) FROM public.isp_providers WHERE code = 'airtel')::int
  UNION ALL
  SELECT 6, 'isp_providers_total', 1,
    (SELECT COUNT(*) FROM public.isp_providers)::int
  UNION ALL
  SELECT 7, 'airtel_town_count', 14,
    (SELECT COUNT(*) FROM airtel_towns)::int
  UNION ALL
  SELECT 8, 'duplicate_airtel_town_keys', 0,
    (SELECT COUNT(*) FROM (
      SELECT town_key FROM airtel_towns GROUP BY town_key HAVING COUNT(*) > 1
    ) d)::int
  UNION ALL
  SELECT 9, 'missing_expected_town_keys', 0,
    (SELECT COUNT(*) FROM expected_towns e
      WHERE NOT EXISTS (
        SELECT 1 FROM airtel_towns a WHERE a.town_key = e.town_key
      ))::int
  UNION ALL
  SELECT 10, 'unexpected_airtel_town_keys', 0,
    (SELECT COUNT(*) FROM airtel_towns a
      WHERE NOT EXISTS (
        SELECT 1 FROM expected_towns e WHERE e.town_key = a.town_key
      ))::int
  UNION ALL
  SELECT 11, 'town_question_id_mismatches', 0,
    (SELECT COUNT(*) FROM airtel_towns a
      JOIN expected_towns e ON e.town_key = a.town_key
      WHERE a.location_question_id IS DISTINCT FROM e.location_question_id)::int
  UNION ALL
  SELECT 12, 'airtel_provider_question_ids', 1,
    (SELECT COUNT(*) FROM public.isp_providers
      WHERE code = 'airtel'
        AND installation_town_question_id = 'rc89257414e57426dac9a183c60a4b556'
        AND delivery_landmark_question_id = 'r7a69684d43ec4bf1b6971b21a8b4dd18'
        AND optional_field_question_id = 'r1e3b5a91acaa465b8aab76bab2cad94a'
        AND is_active = TRUE)::int
  UNION ALL
  SELECT 13, 'isp_installation_locations_empty', 0,
    (SELECT COUNT(*) FROM public.isp_installation_locations)::int
  UNION ALL
  SELECT 14, 'location_isp_mappings', 1087,
    (SELECT COUNT(*) FROM public.location_isp_mappings)::int
)
SELECT
  check_name,
  expected,
  actual,
  (expected = actual) AS pass
FROM checks
ORDER BY sort_order;
