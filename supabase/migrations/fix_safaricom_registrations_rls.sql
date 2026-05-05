-- Fix Safaricom RLS for admin status updates and agent status transitions.
--
-- Problem: agent UPDATE policy used WITH CHECK (status = 'pending'), so any change to
-- approved/installed failed with "new row violates row-level security policy".
--
-- This migration:
-- 1) Sets agent WITH CHECK to only require auth.uid() = agent_id (USING still limits to pending rows).
-- 2) Recreates admin SELECT/UPDATE policies using is_user_admin() when that function exists
--    (same as customer_registrations after fix_admin_rls_recursion); otherwise keeps EXISTS pattern.

DROP POLICY IF EXISTS "Agents can update own pending safaricom registrations" ON safaricom_registrations;

CREATE POLICY "Agents can update own pending safaricom registrations"
  ON safaricom_registrations
  FOR UPDATE
  USING (auth.uid() = agent_id AND status = 'pending')
  WITH CHECK (auth.uid() = agent_id);

DROP POLICY IF EXISTS "Admins can view all safaricom registrations" ON safaricom_registrations;
DROP POLICY IF EXISTS "Admins can update all safaricom registrations" ON safaricom_registrations;

DO $fix$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'is_user_admin' AND n.nspname = 'public'
  ) THEN
    EXECUTE $s$
CREATE POLICY "Admins can view all safaricom registrations"
  ON safaricom_registrations FOR SELECT
  USING (is_user_admin(auth.uid()))
$s$;
    EXECUTE $s$
CREATE POLICY "Admins can update all safaricom registrations"
  ON safaricom_registrations FOR UPDATE
  USING (is_user_admin(auth.uid()))
  WITH CHECK (is_user_admin(auth.uid()))
$s$;
  ELSE
    EXECUTE $s$
CREATE POLICY "Admins can view all safaricom registrations"
  ON safaricom_registrations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = auth.uid() AND agents.is_admin = true
    )
  )
$s$;
    EXECUTE $s$
CREATE POLICY "Admins can update all safaricom registrations"
  ON safaricom_registrations FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = auth.uid() AND agents.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = auth.uid() AND agents.is_admin = true
    )
  )
$s$;
  END IF;
END
$fix$;
