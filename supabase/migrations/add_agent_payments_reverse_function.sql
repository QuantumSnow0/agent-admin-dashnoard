-- Migration: Add safe reversal for accidental agent payouts
-- Run this SQL in Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.admin_reverse_agent_payment(p_payment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_agent_id UUID;
  v_amount NUMERIC(12,2);
BEGIN
  SELECT is_admin INTO v_is_admin
  FROM public.agents
  WHERE id = auth.uid();

  IF COALESCE(v_is_admin, FALSE) = FALSE THEN
    RAISE EXCEPTION 'Only admins can reverse payments';
  END IF;

  SELECT agent_id, amount_ksh
  INTO v_agent_id, v_amount
  FROM public.agent_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  UPDATE public.agents
  SET available_balance = COALESCE(available_balance, 0) + COALESCE(v_amount, 0)
  WHERE id = v_agent_id;

  DELETE FROM public.agent_payments
  WHERE id = p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reverse_agent_payment(UUID) TO authenticated;

COMMENT ON FUNCTION public.admin_reverse_agent_payment(UUID) IS
  'Reverses an accidental payout by restoring agent available_balance and deleting the payment ledger row.';
