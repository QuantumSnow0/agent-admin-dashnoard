-- Migration: Add agent payments ledger for admin payout tracking
-- Run this SQL in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.agent_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  amount_ksh NUMERIC(12,2) NOT NULL CHECK (amount_ksh > 0),
  reference TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.agents(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_payments_agent_created_at
  ON public.agent_payments(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_payments_created_by
  ON public.agent_payments(created_by);

ALTER TABLE public.agent_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all agent payments" ON public.agent_payments;
-- Admins can read all payment records
CREATE POLICY "Admins can view all agent payments"
  ON public.agent_payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  );

DROP POLICY IF EXISTS "Admins can insert agent payments" ON public.agent_payments;
-- Admins can insert payment records
CREATE POLICY "Admins can insert agent payments"
  ON public.agent_payments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Admins can delete agent payments" ON public.agent_payments;
-- Admins can delete payment records (used by reversal fallback)
CREATE POLICY "Admins can delete agent payments"
  ON public.agent_payments
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  );

COMMENT ON TABLE public.agent_payments IS
  'Ledger of payouts made to agents by admins.';

COMMENT ON COLUMN public.agent_payments.amount_ksh IS
  'Amount paid in KES for this payout.';
