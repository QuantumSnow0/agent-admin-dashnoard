-- Extend location_reference with Safaricom installation towns (internetkenya signup).
-- Airtel v1 towns from 20260711140000 remain unchanged (ON CONFLICT DO NOTHING).

-- Strip apostrophes in town keys so MURANG'A / Murang'a resolve consistently.
CREATE OR REPLACE FUNCTION public.normalize_town_key(p_town TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(
    trim(
      regexp_replace(
        replace(coalesce(p_town, ''), '''', ''),
        '\s+',
        ' ',
        'g'
      )
    )
  );
$$;

INSERT INTO public.location_reference (town_key, town_label, county, latitude, longitude)
VALUES
  -- Bomet
  ('bomet', 'Bomet', 'Bomet', -0.7813, 35.3416),
  -- Busia
  ('busia', 'Busia', 'Busia', 0.4604, 34.1115),
  -- Tharaka-Nithi
  ('chuka', 'Chuka', 'Tharaka-Nithi', -0.3333, 37.6500),
  -- Embu
  ('embu', 'Embu', 'Embu', -0.5389, 37.4574),
  -- Homa Bay
  ('homabay', 'Homa Bay', 'Homa Bay', -0.5273, 34.4571),
  -- Isiolo
  ('isiolo', 'Isiolo', 'Isiolo', 0.3546, 37.5822),
  -- Elgeyo-Marakwet
  ('iten', 'Iten', 'Elgeyo-Marakwet', 0.6703, 35.5081),
  -- Baringo
  ('kabarnet', 'Kabarnet', 'Baringo', 0.4919, 35.7430),
  -- West Pokot
  ('kapenguria', 'Kapenguria', 'West Pokot', 1.2389, 35.1119),
  -- Nandi
  ('kapsabet', 'Kapsabet', 'Nandi', 0.2039, 35.1050),
  -- Kericho
  ('kericho', 'Kericho', 'Kericho', -0.3677, 35.2831),
  -- Kirinyaga
  ('kerugoya', 'Kerugoya', 'Kirinyaga', -0.4989, 37.2803),
  -- Kajiado
  ('kitengela', 'Kitengela', 'Kajiado', -1.4744, 36.9444),
  -- Kitui
  ('kitui', 'Kitui', 'Kitui', -1.3667, 38.0167),
  -- Turkana
  ('lodwar', 'Lodwar', 'Turkana', 3.1191, 35.5973),
  -- Vihiga
  ('luanda', 'Luanda', 'Vihiga', 0.0472, 34.5839),
  -- Nyandarua
  ('magumu', 'Magumu', 'Nyandarua', -0.7833, 36.6667),
  -- Kilifi (coastal town)
  ('malindi', 'Malindi', 'Kilifi', -3.2192, 40.1169),
  -- Mandera
  ('mandera', 'Mandera', 'Mandera', 3.9366, 41.8670),
  -- Samburu
  ('maralal', 'Maralal', 'Samburu', 1.0964, 36.6981),
  -- Marsabit
  ('marsabit', 'Marsabit', 'Marsabit', 2.3344, 37.9900),
  -- Meru (sub-town)
  ('maua', 'Maua', 'Meru', 0.2333, 37.9333),
  -- Murang'a
  ('muranga', 'Murang''a', 'Murang''a', -0.7833, 37.0333),
  -- Kirinyaga (Mwea)
  ('mwea', 'Mwea', 'Kirinyaga', -0.6167, 37.3500),
  -- Nakuru (Naivasha)
  ('naivasha', 'Naivasha', 'Nakuru', -0.7167, 36.4333),
  -- Laikipia
  ('nanyuki', 'Nanyuki', 'Laikipia', 0.0167, 37.0667),
  -- Narok
  ('narok', 'Narok', 'Narok', -1.0833, 35.8667),
  -- Laikipia (Nyahururu)
  ('nyahururu', 'Nyahururu', 'Laikipia', -0.0333, 36.3667),
  -- Nyamira
  ('nyamira', 'Nyamira', 'Nyamira', -0.5667, 34.9500),
  -- Nyeri
  ('nyeri', 'Nyeri', 'Nyeri', -0.4201, 36.9476),
  -- Nyandarua
  ('olkalou', 'Ol Kalou', 'Nyandarua', -0.2706, 36.3792),
  -- Kiambu
  ('ruiru', 'Ruiru', 'Kiambu', -1.1466, 36.9608),
  -- Siaya
  ('siaya', 'Siaya', 'Siaya', 0.0607, 34.2881),
  -- Kiambu
  ('thika', 'Thika', 'Kiambu', -1.0333, 37.0693),
  -- Taita-Taveta
  ('voi', 'Voi', 'Taita-Taveta', -3.3961, 38.5561),
  -- Wajir
  ('wajir', 'Wajir', 'Wajir', 1.7471, 40.0573),
  -- Bungoma (Webuye)
  ('webuye', 'Webuye', 'Bungoma', 0.6000, 34.7667),
  -- Makueni
  ('wote', 'Wote', 'Makueni', -1.7833, 37.6333)
ON CONFLICT (town_key) DO NOTHING;

-- Re-queue Safaricom leads that landed in admin_queue only because the town was unknown.
UPDATE public.inbound_leads
SET
  status = 'pending_dispatch',
  county = public.resolve_county_from_town(installation_town)
WHERE status = 'admin_queue'
  AND product = 'safaricom'
  AND public.resolve_county_from_town(installation_town) IS NOT NULL;

-- Refresh cached agent counties (e.g. if agent town now resolves via a new row).
UPDATE public.agent_dispatch_settings ads
SET
  county = public.resolve_county_from_town(a.town),
  updated_at = now()
FROM public.agents a
WHERE a.id = ads.agent_id
  AND ads.county IS DISTINCT FROM public.resolve_county_from_town(a.town);
