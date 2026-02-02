# Admin RLS Policies Setup

## Problem

The admin dashboard is showing `0` for pending approvals and other statistics, even though there are agents awaiting approval. This is because **Row Level Security (RLS) policies** are blocking admin users from reading data from other agents.

## Current RLS Policies

Currently, the RLS policies only allow:
- Agents to view their **own** profile
- Agents to update their **own** profile (if pending)

This means admin users can only see their own data, not all agents and registrations.

## Solution

We need to add **admin-specific RLS policies** that allow users with `is_admin = TRUE` to read and update all data.

## Migration Steps

### Step 1: Run the Admin RLS Policies Migration

1. Go to your **Supabase Dashboard** → **SQL Editor**
2. Copy and paste the contents of `supabase/migrations/add_admin_rls_policies.sql`
3. Click **"Run"** to execute

This will create policies that:
- ✅ Allow admins to view all agents
- ✅ Allow admins to update all agents (for status changes)
- ✅ Allow admins to view all customer registrations
- ✅ Allow admins to update all customer registrations (for status changes)
- ✅ Allow admins to view all notifications
- ✅ Allow admins to view all device tokens

### Step 2: Verify the Policies

Run this query to verify the policies were created:

```sql
SELECT 
  tablename,
  policyname,
  cmd
FROM pg_policies 
WHERE tablename IN ('agents', 'customer_registrations', 'notifications', 'device_tokens')
  AND policyname LIKE '%Admin%'
ORDER BY tablename, policyname;
```

You should see policies like:
- `Admins can view all agents`
- `Admins can update all agents`
- `Admins can view all customer registrations`
- `Admins can update all customer registrations`
- `Admins can view all notifications`
- `Admins can view all device tokens`

### Step 3: Test the Dashboard

1. Refresh your admin dashboard
2. Check if pending approvals now shows the correct count
3. Verify all statistics are displaying correctly

## How It Works

The admin policies use a check like this:

```sql
EXISTS (
  SELECT 1 FROM agents
  WHERE id = auth.uid()
  AND is_admin = TRUE
)
```

This checks if the current user (`auth.uid()`) has `is_admin = TRUE` in the `agents` table. If yes, they can access all data.

## Security Notes

- ✅ **Admin policies are additive** - They don't remove existing agent policies
- ✅ **Agents can still only see their own data** - The original policies remain
- ✅ **Only verified admins** can access all data (must have `is_admin = TRUE`)
- ✅ **RLS is still enabled** - Non-admins are still restricted

## Troubleshooting

### Issue: Still showing 0 after running migration

**Check:**
1. Make sure you ran the migration SQL successfully
2. Verify your admin user has `is_admin = TRUE`:
   ```sql
   SELECT id, email, is_admin FROM agents WHERE email = 'your-admin@email.com';
   ```
3. Check browser console for errors
4. Try logging out and logging back in

### Issue: Migration fails with "policy already exists"

**Solution:**
The migration uses `CREATE POLICY` which will fail if the policy exists. You can either:
1. Drop the existing policy first:
   ```sql
   DROP POLICY IF EXISTS "Admins can view all agents" ON agents;
   ```
2. Or modify the migration to use `CREATE POLICY IF NOT EXISTS` (PostgreSQL 9.5+)

### Issue: Can see agents but can't update them

**Check:**
1. Verify the UPDATE policy exists:
   ```sql
   SELECT policyname FROM pg_policies 
   WHERE tablename = 'agents' 
   AND policyname LIKE '%Admin%update%';
   ```
2. Make sure your admin user has `is_admin = TRUE`
3. Check if there are conflicting policies

## Next Steps

After running this migration:
1. ✅ Admin dashboard will show correct statistics
2. ✅ Admin can view all agents
3. ✅ Admin can approve/reject agents
4. ✅ Admin can view all registrations
5. ✅ Admin can update registration statuses

---

**Important**: Make sure you've already:
- ✅ Run `add_admin_role.sql` (adds `is_admin` column)
- ✅ Set `is_admin = TRUE` for your admin user(s)

See `ADMIN_ROLE_IMPLEMENTATION.md` for details.
