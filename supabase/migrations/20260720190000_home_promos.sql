-- Home promo carousel — admin-managed slides for the agent app Home screen.

CREATE TABLE IF NOT EXISTS public.home_promos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  subtitle text,
  image_url text NOT NULL,
  cta_label text NOT NULL DEFAULT 'Learn more',
  cta_action text NOT NULL
    CHECK (cta_action IN ('register_safaricom', 'register_airtel', 'leads')),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS home_promos_active_sort_idx
  ON public.home_promos (is_active, sort_order ASC, created_at DESC);

ALTER TABLE public.home_promos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active home promos" ON public.home_promos;
CREATE POLICY "Authenticated read active home promos"
  ON public.home_promos
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
  );

DROP POLICY IF EXISTS "Admins read all home promos" ON public.home_promos;
CREATE POLICY "Admins read all home promos"
  ON public.home_promos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = auth.uid() AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins insert home promos" ON public.home_promos;
CREATE POLICY "Admins insert home promos"
  ON public.home_promos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = auth.uid() AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins update home promos" ON public.home_promos;
CREATE POLICY "Admins update home promos"
  ON public.home_promos
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = auth.uid() AND is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = auth.uid() AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins delete home promos" ON public.home_promos;
CREATE POLICY "Admins delete home promos"
  ON public.home_promos
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Public image bucket for carousel assets (admins upload via dashboard).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'home-promos',
  'home-promos',
  true,
  3145728,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 3145728,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

DROP POLICY IF EXISTS "Public read home promo images" ON storage.objects;
CREATE POLICY "Public read home promo images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'home-promos');

DROP POLICY IF EXISTS "Admins upload home promo images" ON storage.objects;
CREATE POLICY "Admins upload home promo images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'home-promos'
    AND EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = auth.uid() AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins update home promo images" ON storage.objects;
CREATE POLICY "Admins update home promo images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'home-promos'
    AND EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = auth.uid() AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins delete home promo images" ON storage.objects;
CREATE POLICY "Admins delete home promo images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'home-promos'
    AND EXISTS (
      SELECT 1 FROM public.agents
      WHERE id = auth.uid() AND is_admin = true
    )
  );
