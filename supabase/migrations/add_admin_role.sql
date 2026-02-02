-- Migration: Add Admin Role Support
-- Run this SQL in your Supabase SQL Editor

-- Step 1: Add is_admin column to agents table
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Step 2: Create index for faster admin lookups
CREATE INDEX IF NOT EXISTS idx_agents_is_admin ON agents(is_admin) WHERE is_admin = TRUE;

-- Step 3: Add comment for documentation
COMMENT ON COLUMN agents.is_admin IS 'Indicates if the agent has admin privileges for the admin dashboard';

-- Step 4: Create a function to check if user is admin (helper for RLS or application logic)
CREATE OR REPLACE FUNCTION is_admin_user(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM agents
    WHERE id = user_id
    AND is_admin = TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: (Optional) Grant admin access to existing users if needed
-- Uncomment and modify email address if you want to grant admin to an existing user
/*
UPDATE agents
SET is_admin = TRUE
WHERE email = 'admin@airtel.com';
*/

-- Step 6: Verify the migration
SELECT 
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'agents'
AND column_name = 'is_admin';
