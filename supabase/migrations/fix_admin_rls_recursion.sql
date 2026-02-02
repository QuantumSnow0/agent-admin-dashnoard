-- Fix Admin RLS Policies - Remove Infinite Recursion
-- Run this SQL in your Supabase SQL Editor
-- This fixes the "infinite recursion detected in policy" error

-- ============================================================
-- Step 1: Drop the problematic admin policies
-- ============================================================

DROP POLICY IF EXISTS "Admins can view all agents" ON agents;
DROP POLICY IF EXISTS "Admins can update all agents" ON agents;
DROP POLICY IF EXISTS "Admins can view all customer registrations" ON customer_registrations;
DROP POLICY IF EXISTS "Admins can update all customer registrations" ON customer_registrations;
DROP POLICY IF EXISTS "Admins can view all notifications" ON notifications;
DROP POLICY IF EXISTS "Admins can view all device tokens" ON device_tokens;

-- ============================================================
-- Step 2: Create a helper function that bypasses RLS
-- ============================================================

-- Create a function that checks if user is admin (with SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION is_user_admin(check_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM agents
    WHERE id = check_user_id
    AND is_admin = TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION is_user_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_user_admin(UUID) TO anon;

-- ============================================================
-- Step 3: Create new admin policies using the helper function
-- ============================================================

-- Policy: Admins can view all agents (using helper function to avoid recursion)
CREATE POLICY "Admins can view all agents"
  ON agents
  FOR SELECT
  USING (is_user_admin(auth.uid()));

-- Policy: Admins can update all agents
CREATE POLICY "Admins can update all agents"
  ON agents
  FOR UPDATE
  USING (is_user_admin(auth.uid()))
  WITH CHECK (is_user_admin(auth.uid()));

-- ============================================================
-- CUSTOMER_REGISTRATIONS TABLE - Admin Policies
-- ============================================================

-- Policy: Admins can view all customer registrations
CREATE POLICY "Admins can view all customer registrations"
  ON customer_registrations
  FOR SELECT
  USING (is_user_admin(auth.uid()));

-- Policy: Admins can update all customer registrations
CREATE POLICY "Admins can update all customer registrations"
  ON customer_registrations
  FOR UPDATE
  USING (is_user_admin(auth.uid()))
  WITH CHECK (is_user_admin(auth.uid()));

-- ============================================================
-- NOTIFICATIONS TABLE - Admin Policies
-- ============================================================

-- Policy: Admins can view all notifications
CREATE POLICY "Admins can view all notifications"
  ON notifications
  FOR SELECT
  USING (is_user_admin(auth.uid()));

-- ============================================================
-- DEVICE_TOKENS TABLE - Admin Policies
-- ============================================================

-- Policy: Admins can view all device tokens
CREATE POLICY "Admins can view all device tokens"
  ON device_tokens
  FOR SELECT
  USING (is_user_admin(auth.uid()));

-- ============================================================
-- Verification Query
-- ============================================================

-- Test the function (should return TRUE for admin, FALSE for non-admin)
-- SELECT is_user_admin('your-user-id-here');

-- Check all policies
SELECT 
  tablename,
  policyname,
  cmd
FROM pg_policies 
WHERE tablename IN ('agents', 'customer_registrations', 'notifications', 'device_tokens')
  AND policyname LIKE '%Admin%'
ORDER BY tablename, policyname;
