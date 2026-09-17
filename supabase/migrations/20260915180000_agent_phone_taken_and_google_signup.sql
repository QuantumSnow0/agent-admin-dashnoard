-- Phone duplicate checks for registration / Google complete-profile.
-- Skip auto agent insert when signup has no phones (Google OAuth path).

CREATE OR REPLACE FUNCTION public.normalize_ke_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  digits := regexp_replace(raw, '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NULL;
  END IF;
  -- Kenya local 07XXXXXXXX / 01XXXXXXXX → 2547… / 2541…
  IF length(digits) = 10 AND left(digits, 1) = '0' THEN
    digits := '254' || substring(digits from 2);
  ELSIF length(digits) = 9 AND left(digits, 1) IN ('7', '1') THEN
    digits := '254' || digits;
  END IF;
  RETURN digits;
END;
$$;

COMMENT ON FUNCTION public.normalize_ke_phone(text) IS
  'Normalize Kenya phone to digits with 254 country code for duplicate matching.';

CREATE OR REPLACE FUNCTION public.agent_phones_taken(
  p_airtel text,
  p_safaricom text,
  p_exclude_agent_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_airtel text := public.normalize_ke_phone(p_airtel);
  v_safaricom text := public.normalize_ke_phone(p_safaricom);
  v_hit record;
BEGIN
  IF v_airtel IS NULL AND v_safaricom IS NULL THEN
    RETURN jsonb_build_object(
      'taken', false,
      'airtel_taken', false,
      'safaricom_taken', false
    );
  END IF;

  SELECT a.id, a.email
  INTO v_hit
  FROM public.agents a
  WHERE (p_exclude_agent_id IS NULL OR a.id <> p_exclude_agent_id)
    AND (
      (
        v_airtel IS NOT NULL
        AND (
          public.normalize_ke_phone(a.airtel_phone) = v_airtel
          OR public.normalize_ke_phone(a.safaricom_phone) = v_airtel
        )
      )
      OR (
        v_safaricom IS NOT NULL
        AND (
          public.normalize_ke_phone(a.airtel_phone) = v_safaricom
          OR public.normalize_ke_phone(a.safaricom_phone) = v_safaricom
        )
      )
    )
  LIMIT 1;

  IF v_hit.id IS NULL THEN
    RETURN jsonb_build_object(
      'taken', false,
      'airtel_taken', false,
      'safaricom_taken', false
    );
  END IF;

  RETURN jsonb_build_object(
    'taken', true,
    'airtel_taken',
      v_airtel IS NOT NULL
      AND (
        public.normalize_ke_phone(
          (SELECT airtel_phone FROM public.agents WHERE id = v_hit.id)
        ) = v_airtel
        OR public.normalize_ke_phone(
          (SELECT safaricom_phone FROM public.agents WHERE id = v_hit.id)
        ) = v_airtel
      ),
    'safaricom_taken',
      v_safaricom IS NOT NULL
      AND (
        public.normalize_ke_phone(
          (SELECT airtel_phone FROM public.agents WHERE id = v_hit.id)
        ) = v_safaricom
        OR public.normalize_ke_phone(
          (SELECT safaricom_phone FROM public.agents WHERE id = v_hit.id)
        ) = v_safaricom
      ),
    'existing_agent_id', v_hit.id
  );
END;
$$;

COMMENT ON FUNCTION public.agent_phones_taken(text, text, uuid) IS
  'Returns whether either phone matches an existing agent (cross Airtel/Safaricom).';

REVOKE ALL ON FUNCTION public.normalize_ke_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_ke_phone(text) TO authenticated, anon, service_role;

REVOKE ALL ON FUNCTION public.agent_phones_taken(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_phones_taken(text, text, uuid) TO authenticated, anon, service_role;

-- Allow authenticated users to create their own agent row (Google complete-profile / OTP path).
DROP POLICY IF EXISTS "Agents can insert own profile" ON public.agents;
CREATE POLICY "Agents can insert own profile"
  ON public.agents
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Google OAuth users have no phones in metadata — do not create an empty agents row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  place jsonb;
  v_airtel text;
  v_safaricom text;
BEGIN
  v_airtel := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'airtel_phone', '')), '');
  v_safaricom := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'safaricom_phone', '')), '');

  IF v_airtel IS NULL AND v_safaricom IS NULL THEN
    RETURN NEW;
  END IF;

  place := CASE
    WHEN jsonb_typeof(NEW.raw_user_meta_data->'working_place') = 'object'
      THEN NEW.raw_user_meta_data->'working_place'
    ELSE NULL
  END;

  INSERT INTO public.agents (
    id,
    email,
    name,
    airtel_phone,
    safaricom_phone,
    town,
    area,
    working_place,
    working_place_updated_at,
    status,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', ''),
    v_airtel,
    v_safaricom,
    COALESCE(NEW.raw_user_meta_data->>'town', NULL),
    COALESCE(NEW.raw_user_meta_data->>'area', NULL),
    place,
    CASE WHEN place IS NOT NULL THEN NOW() ELSE NULL END,
    'pending',
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, agents.name),
    email = EXCLUDED.email,
    working_place = COALESCE(EXCLUDED.working_place, agents.working_place),
    working_place_updated_at = COALESCE(
      EXCLUDED.working_place_updated_at,
      agents.working_place_updated_at
    );

  RETURN NEW;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'Error creating agent profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
