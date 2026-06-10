-- App ratings from agents (in-app star rating before Play Store prompt)

CREATE TABLE IF NOT EXISTS public.app_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL UNIQUE REFERENCES public.agents(id) ON DELETE CASCADE,
  score SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
  opened_play_store BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_ratings_agent_id ON public.app_ratings(agent_id);
CREATE INDEX IF NOT EXISTS idx_app_ratings_score ON public.app_ratings(score);
CREATE INDEX IF NOT EXISTS idx_app_ratings_created_at ON public.app_ratings(created_at DESC);

ALTER TABLE public.app_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents can view own app rating" ON public.app_ratings;
DROP POLICY IF EXISTS "Agents can insert own app rating" ON public.app_ratings;
DROP POLICY IF EXISTS "Agents can update own app rating" ON public.app_ratings;
DROP POLICY IF EXISTS "Admins can view all app ratings" ON public.app_ratings;

CREATE POLICY "Agents can view own app rating"
  ON public.app_ratings
  FOR SELECT
  USING (auth.uid() = agent_id);

CREATE POLICY "Agents can insert own app rating"
  ON public.app_ratings
  FOR INSERT
  WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "Agents can update own app rating"
  ON public.app_ratings
  FOR UPDATE
  USING (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "Admins can view all app ratings"
  ON public.app_ratings
  FOR SELECT
  USING (is_user_admin(auth.uid()));
