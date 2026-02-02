# Fix: Infinite Recursion in RLS Policies

## The Problem

**Error Code**: `42P17`  
**Error Message**: `infinite recursion detected in policy for relation "agents"`

## Root Cause

The admin RLS policies were creating infinite recursion:

```sql
-- ❌ BAD - Causes infinite recursion
CREATE POLICY "Admins can view all agents"
  ON agents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents  -- ← This triggers the same policy again!
      WHERE id = auth.uid()
      AND is_admin = TRUE
    )
  );
```

When the policy tries to check if a user is admin by querying `agents`, it triggers the same policy, which queries `agents` again, creating an infinite loop.

## The Solution

Use a **helper function with `SECURITY DEFINER`** that bypasses RLS to check admin status.

### Step 1: Run the Fix Migration

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Open `admin-dashboard/supabase/migrations/fix_admin_rls_recursion.sql`
3. Copy all the SQL
4. Paste into SQL Editor
5. Click **"Run"**

This will:
- ✅ Drop the problematic recursive policies
- ✅ Create a helper function `is_user_admin()` with `SECURITY DEFINER` (bypasses RLS)
- ✅ Recreate all admin policies using the helper function (no recursion)

### Step 2: Verify It Works

After running the migration:

1. **Check the function exists**:
```sql
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'is_user_admin';
```

2. **Test the function** (replace with your user ID):
```sql
-- Should return TRUE for admin, FALSE for non-admin
SELECT is_user_admin('3f5eb616-492a-40e3-bc58-9673ff2f7d0c');
```

3. **Check policies were recreated**:
```sql
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'agents'
AND policyname LIKE '%Admin%';
```

### Step 3: Test Login

1. Refresh your browser
2. Try logging in again
3. Should work without the 500 error!

## How It Works

The `is_user_admin()` function:

```sql
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
```

**Key points:**
- `SECURITY DEFINER` - Runs with the privileges of the function creator (bypasses RLS)
- `STABLE` - Optimization hint that the result doesn't change within a transaction
- No recursion - Function query doesn't trigger RLS policies

## What Changed

**Before (Recursive):**
```sql
EXISTS (
  SELECT 1 FROM agents  -- ← Triggers RLS policy
  WHERE id = auth.uid()
  AND is_admin = TRUE
)
```

**After (No Recursion):**
```sql
is_user_admin(auth.uid())  -- ← Uses SECURITY DEFINER function (bypasses RLS)
```

## Verification Checklist

- [ ] Function `is_user_admin()` created
- [ ] Function returns `TRUE` for admin users
- [ ] Admin policies recreated without recursion
- [ ] Login works without 500 error
- [ ] Dashboard shows correct data

---

**Important**: Make sure you've run this fix migration before testing login again!
