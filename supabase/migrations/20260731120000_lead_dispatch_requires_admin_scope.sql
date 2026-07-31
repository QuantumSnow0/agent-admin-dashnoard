-- Lead receiving requires explicit admin enable (lead_dispatch_scope),
-- separate from account approval (agents.status).

-- New agents: no inbound leads until admin sets scope.
ALTER TABLE public.agents
  ALTER COLUMN lead_dispatch_scope SET DEFAULT 'none';

-- Pending / rejected / banned must not keep an open dispatch scope.
UPDATE public.agents
SET lead_dispatch_scope = 'none'
WHERE status IS DISTINCT FROM 'approved'
  AND lead_dispatch_scope IS DISTINCT FROM 'none';

-- Clear availability when agent leaves approved or loses dispatch scope.
CREATE OR REPLACE FUNCTION public.agents_clear_dispatch_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.status IS DISTINCT FROM 'approved'
    OR COALESCE(NEW.lead_dispatch_scope, 'none') = 'none'
  ) THEN
    UPDATE public.agent_dispatch_settings
    SET
      is_available = false,
      updated_at = now()
    WHERE agent_id = NEW.id
      AND is_available = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agents_clear_dispatch_availability ON public.agents;
CREATE TRIGGER trg_agents_clear_dispatch_availability
  AFTER UPDATE OF status, lead_dispatch_scope ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.agents_clear_dispatch_availability();

-- Agents may only turn ON availability when approved and scope allows leads.
DROP POLICY IF EXISTS "Agents update own dispatch settings" ON public.agent_dispatch_settings;
CREATE POLICY "Agents update own dispatch settings"
  ON public.agent_dispatch_settings FOR UPDATE
  USING (auth.uid() = agent_id)
  WITH CHECK (
    auth.uid() = agent_id
    AND (
      is_available = false
      OR EXISTS (
        SELECT 1
        FROM public.agents a
        WHERE a.id = auth.uid()
          AND a.status = 'approved'
          AND coalesce(a.lead_dispatch_scope, 'none') <> 'none'
      )
    )
  );

DROP POLICY IF EXISTS "Agents insert own dispatch settings" ON public.agent_dispatch_settings;
CREATE POLICY "Agents insert own dispatch settings"
  ON public.agent_dispatch_settings FOR INSERT
  WITH CHECK (
    auth.uid() = agent_id
    AND (
      is_available = false
      OR EXISTS (
        SELECT 1
        FROM public.agents a
        WHERE a.id = auth.uid()
          AND a.status = 'approved'
          AND coalesce(a.lead_dispatch_scope, 'none') <> 'none'
      )
    )
  );

COMMENT ON COLUMN public.agents.lead_dispatch_scope IS
  'Admin gate for inbound website leads. Default none — account approval alone does not enable leads.';
