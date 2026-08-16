-- =============================================================================
-- Live validation after Airtel location_isp_mappings seed
-- SELECT only. Classification CASE matches the 13 August dry-run.
-- =============================================================================

WITH classified AS (
  SELECT
    l.id,
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
airtel_mappings AS (
  SELECT
    m.location_id,
    m.isp_location_id,
    m.mapping_kind,
    m.notes,
    t.town_key
  FROM public.location_isp_mappings m
  JOIN public.isp_providers p ON p.id = m.provider_id
  JOIN public.isp_installation_towns t ON t.id = m.isp_town_id
  WHERE p.code = 'airtel'
),
checks AS (
  SELECT 1 AS sort_order, 'locations' AS check_name, 2571 AS expected,
    (SELECT COUNT(*) FROM public.locations)::int AS actual
  UNION ALL
  SELECT 2, 'isp_providers', 1,
    (SELECT COUNT(*) FROM public.isp_providers)::int
  UNION ALL
  SELECT 3, 'isp_installation_towns', 14,
    (SELECT COUNT(*) FROM public.isp_installation_towns)::int
  UNION ALL
  SELECT 4, 'isp_installation_locations', 0,
    (SELECT COUNT(*) FROM public.isp_installation_locations)::int
  UNION ALL
  SELECT 5, 'location_isp_mappings', 1087,
    (SELECT COUNT(*) FROM public.location_isp_mappings)::int
  UNION ALL
  SELECT 6, 'airtel_mappings', 1087,
    (SELECT COUNT(*) FROM airtel_mappings)::int
  UNION ALL
  SELECT 7, 'classified_mapped', 1087,
    (SELECT COUNT(*) FROM with_town WHERE town_key IS NOT NULL)::int
  UNION ALL
  SELECT 8, 'classified_uncovered', 1484,
    (SELECT COUNT(*) FROM with_town
      WHERE town_key IS NULL
        AND operational_area IS DISTINCT FROM '__AMBIGUOUS__')::int
  UNION ALL
  SELECT 9, 'classified_ambiguous', 0,
    (SELECT COUNT(*) FROM with_town WHERE operational_area = '__AMBIGUOUS__')::int
  UNION ALL
  SELECT 10, 'uncovered_with_mapping', 0,
    (SELECT COUNT(*) FROM with_town w
      JOIN airtel_mappings m ON m.location_id = w.id
      WHERE w.town_key IS NULL)::int
  UNION ALL
  SELECT 11, 'duplicate_location_provider', 0,
    (
      (SELECT COUNT(*) FROM airtel_mappings)
      - (SELECT COUNT(DISTINCT location_id) FROM airtel_mappings)
    )::int
  UNION ALL
  SELECT 12, 'null_isp_location_id', 1087,
    (SELECT COUNT(*) FROM airtel_mappings WHERE isp_location_id IS NULL)::int
  UNION ALL
  SELECT 13, 'mapping_kind_manual', 1087,
    (SELECT COUNT(*) FROM public.location_isp_mappings WHERE mapping_kind = 'manual')::int
  UNION ALL
  SELECT 14, 'thika_mapped_kiambu', 15,
    (SELECT COUNT(*) FROM with_town w
      JOIN airtel_mappings m ON m.location_id = w.id
      WHERE w.district = 'Thika' AND w.operational_area = 'Kiambu')::int
  UNION ALL
  SELECT 15, 'thika_uncovered', 11,
    (SELECT COUNT(*) FROM with_town
      WHERE district = 'Thika'
        AND town_key IS NULL
        AND operational_area IS DISTINCT FROM '__AMBIGUOUS__')::int
  UNION ALL
  SELECT 16, 'thika_uncovered_mapped', 0,
    (SELECT COUNT(*) FROM with_town w
      JOIN airtel_mappings m ON m.location_id = w.id
      WHERE w.district = 'Thika' AND w.town_key IS NULL)::int
  UNION ALL
  SELECT 17, 'town_BUNGOMA', 60,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'BUNGOMA')::int
  UNION ALL
  SELECT 18, 'town_ELDORET', 51,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'ELDORET')::int
  UNION ALL
  SELECT 19, 'town_GARISSA', 62,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'GARISSA')::int
  UNION ALL
  SELECT 20, 'town_KAKAMEGA', 62,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'KAKAMEGA')::int
  UNION ALL
  SELECT 21, 'town_KILIFI', 52,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'KILIFI')::int
  UNION ALL
  SELECT 22, 'town_KISII', 82,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'KISII')::int
  UNION ALL
  SELECT 23, 'town_KISUMU', 57,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'KISUMU')::int
  UNION ALL
  SELECT 24, 'town_KITALE', 86,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'KITALE')::int
  UNION ALL
  SELECT 25, 'town_MACHAKOS', 63,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'MACHAKOS')::int
  UNION ALL
  SELECT 26, 'town_MERU', 114,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'MERU')::int
  UNION ALL
  SELECT 27, 'town_MIGORI', 69,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'MIGORI')::int
  UNION ALL
  SELECT 28, 'town_MOMBASA', 55,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'MOMBASA')::int
  UNION ALL
  SELECT 29, 'town_NAIROBI', 205,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'NAIROBI')::int
  UNION ALL
  SELECT 30, 'town_NAKURU', 69,
    (SELECT COUNT(*) FROM airtel_mappings WHERE town_key = 'NAKURU')::int
  UNION ALL
  SELECT 31, 'area_Bungoma', 60,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Bungoma')::int
  UNION ALL
  SELECT 32, 'area_Garissa', 62,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Garissa')::int
  UNION ALL
  SELECT 33, 'area_Kajiado', 47,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Kajiado')::int
  UNION ALL
  SELECT 34, 'area_Kakamega', 62,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Kakamega')::int
  UNION ALL
  SELECT 35, 'area_Kiambu', 53,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Kiambu')::int
  UNION ALL
  SELECT 36, 'area_Kilifi', 52,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Kilifi')::int
  UNION ALL
  SELECT 37, 'area_Kisii', 58,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Kisii')::int
  UNION ALL
  SELECT 38, 'area_Kisumu', 57,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Kisumu')::int
  UNION ALL
  SELECT 39, 'area_Kwale', 37,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Kwale')::int
  UNION ALL
  SELECT 40, 'area_Machakos', 63,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Machakos')::int
  UNION ALL
  SELECT 41, 'area_Meru', 114,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Meru')::int
  UNION ALL
  SELECT 42, 'area_Migori', 69,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Migori')::int
  UNION ALL
  SELECT 43, 'area_Mombasa', 18,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Mombasa')::int
  UNION ALL
  SELECT 44, 'area_Nairobi', 58,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Nairobi')::int
  UNION ALL
  SELECT 45, 'area_Nakuru', 69,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Nakuru')::int
  UNION ALL
  SELECT 46, 'area_Nyamira', 24,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Nyamira')::int
  UNION ALL
  SELECT 47, 'area_Tharaka-Nithi', 47,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Tharaka-Nithi')::int
  UNION ALL
  SELECT 48, 'area_Trans Nzoia', 28,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Trans Nzoia')::int
  UNION ALL
  SELECT 49, 'area_Uasin Gishu', 51,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=Uasin Gishu')::int
  UNION ALL
  SELECT 50, 'area_West Pokot', 58,
    (SELECT COUNT(*) FROM airtel_mappings WHERE notes = 'operational_area=West Pokot')::int
)
SELECT
  check_name,
  expected,
  actual,
  (expected = actual) AS pass
FROM checks
ORDER BY sort_order;
