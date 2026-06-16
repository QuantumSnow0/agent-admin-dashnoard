-- Super admin: controls MS Forms submission via /super-admin (separate from is_admin dashboard)
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_agents_is_super_admin
ON agents(is_super_admin)
WHERE is_super_admin = TRUE;

COMMENT ON COLUMN agents.is_super_admin IS
  'Can access /super-admin to approve and submit registrations to Microsoft Forms';

-- Grant yourself super admin (replace email):
-- UPDATE agents SET is_super_admin = TRUE WHERE email = 'your@email.com';
