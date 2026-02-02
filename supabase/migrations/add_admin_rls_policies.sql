-- Admin RLS Policies Migration
-- Run this SQL in your Supabase SQL Editor
-- This allows admins to read and update all agent data and registrations

-- ============================================================
-- AGENTS TABLE - Admin Policies
-- ============================================================

-- Policy: Admins can view all agents
CREATE POLICY "Admins can view all agents"
  ON agents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  );

-- Policy: Admins can update all agents (for status changes, etc.)
CREATE POLICY "Admins can update all agents"
  ON agents
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  );

-- ============================================================
-- CUSTOMER_REGISTRATIONS TABLE - Admin Policies
-- ============================================================

-- Policy: Admins can view all customer registrations
CREATE POLICY "Admins can view all customer registrations"
  ON customer_registrations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  );

-- Policy: Admins can update all customer registrations (for status changes)
CREATE POLICY "Admins can update all customer registrations"
  ON customer_registrations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  );

-- ============================================================
-- NOTIFICATIONS TABLE - Admin Policies
-- ============================================================

-- Policy: Admins can view all notifications
CREATE POLICY "Admins can view all notifications"
  ON notifications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  );

-- ============================================================
-- DEVICE_TOKENS TABLE - Admin Policies (if needed for push notifications)
-- ============================================================

-- Policy: Admins can view all device tokens (for sending notifications)
CREATE POLICY "Admins can view all device tokens"
  ON device_tokens
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  );

-- ============================================================
-- Verification Query
-- ============================================================

-- Check all policies on agents table
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies 
WHERE tablename IN ('agents', 'customer_registrations', 'notifications', 'device_tokens')
ORDER BY tablename, policyname;
