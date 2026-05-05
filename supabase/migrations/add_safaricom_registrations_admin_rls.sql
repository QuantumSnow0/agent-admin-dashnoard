-- Admin RLS for safaricom_registrations (mirror add_admin_rls_policies customer_registrations).
-- Run after SAFARICOM_REGISTRATIONS_SCHEMA.sql exists on the project.
-- Also run fix_safaricom_registrations_rls.sql (agent WITH CHECK + is_user_admin when available).

ALTER TABLE safaricom_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all safaricom registrations" ON safaricom_registrations;
CREATE POLICY "Admins can view all safaricom registrations"
  ON safaricom_registrations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = auth.uid()
      AND agents.is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins can update all safaricom registrations" ON safaricom_registrations;
CREATE POLICY "Admins can update all safaricom registrations"
  ON safaricom_registrations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = auth.uid()
      AND agents.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = auth.uid()
      AND agents.is_admin = true
    )
  );
