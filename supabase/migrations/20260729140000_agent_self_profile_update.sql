-- Allow agents (pending or approved) to update their own profile details.
-- Privileged columns are locked for non-admin self-updates via trigger.

DROP POLICY IF EXISTS "Agents can update own profile before approval" ON public.agents;
DROP POLICY IF EXISTS "Agents can update own profile details" ON public.agents;

CREATE POLICY "Agents can update own profile details"
  ON public.agents
  FOR UPDATE
  USING (
    auth.uid() = id
    AND status IN ('pending', 'approved')
  )
  WITH CHECK (
    auth.uid() = id
    AND status IN ('pending', 'approved')
  );

CREATE OR REPLACE FUNCTION public.agents_protect_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updater_is_admin boolean := false;
BEGIN
  -- Service role / dashboard bypass
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(is_admin, false)
  INTO updater_is_admin
  FROM public.agents
  WHERE id = auth.uid();

  IF coalesce(updater_is_admin, false) THEN
    RETURN NEW;
  END IF;

  -- Non-admin self-update: keep privileged fields unchanged
  IF auth.uid() = OLD.id THEN
    NEW.id := OLD.id;
    NEW.email := OLD.email;
    NEW.status := OLD.status;
    NEW.is_admin := OLD.is_admin;
    NEW.lead_dispatch_scope := OLD.lead_dispatch_scope;
    NEW.is_fallback_agent := OLD.is_fallback_agent;
    NEW.fallback_priority := OLD.fallback_priority;
    NEW.total_earnings := OLD.total_earnings;
    NEW.available_balance := OLD.available_balance;
    NEW.created_at := OLD.created_at;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agents_protect_self_update ON public.agents;
CREATE TRIGGER trg_agents_protect_self_update
  BEFORE UPDATE ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.agents_protect_self_update();

COMMENT ON FUNCTION public.agents_protect_self_update() IS
  'Locks status/admin/scope/balance/email on non-admin self profile updates.';
