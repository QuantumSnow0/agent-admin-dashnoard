-- MS Forms submission mode: auto (on registration save) or manual (super-admin queue).

CREATE TABLE IF NOT EXISTS public.ms_forms_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (submission_mode IN ('auto', 'manual')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ms_forms_config_single ON public.ms_forms_config ((1));

INSERT INTO public.ms_forms_config (submission_mode)
SELECT 'manual'
WHERE NOT EXISTS (SELECT 1 FROM public.ms_forms_config);

ALTER TABLE public.ms_forms_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read ms forms config" ON public.ms_forms_config;
CREATE POLICY "Authenticated can read ms forms config"
  ON public.ms_forms_config
  FOR SELECT
  TO authenticated
  USING (TRUE);

COMMENT ON TABLE public.ms_forms_config IS
  'Single-row config: auto = submit new Airtel leads to MS Forms on save; manual = super-admin queue only.';

COMMENT ON COLUMN public.ms_forms_config.submission_mode IS
  'auto | manual';
