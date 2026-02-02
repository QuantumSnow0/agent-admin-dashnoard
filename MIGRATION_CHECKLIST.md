# Migration Checklist

## ⚠️ Important: Run Migrations in Order!

You're getting a 500 error because the `is_admin` column doesn't exist yet. Follow these steps **in order**:

## Step 1: Add Admin Role Column ✅

**File**: `supabase/migrations/add_admin_role.sql`

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Open `admin-dashboard/supabase/migrations/add_admin_role.sql`
3. Copy all the SQL
4. Paste into SQL Editor
5. Click **"Run"**

This adds the `is_admin` column to the `agents` table.

**Verify it worked:**
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'agents' 
AND column_name = 'is_admin';
```

## Step 2: Grant Admin Access to Your User ✅

After Step 1, grant yourself admin access:

```sql
-- Replace with your actual admin email
UPDATE agents
SET is_admin = TRUE
WHERE email = 'your-admin@email.com';
```

**Verify:**
```sql
SELECT id, email, name, is_admin
FROM agents
WHERE is_admin = TRUE;
```

## Step 3: Add Admin RLS Policies ✅

**File**: `supabase/migrations/add_admin_rls_policies.sql`

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Open `admin-dashboard/supabase/migrations/add_admin_rls_policies.sql`
3. Copy all the SQL
4. Paste into SQL Editor
5. Click **"Run"**

This allows admins to view all agents and registrations.

**Verify:**
```sql
SELECT policyname 
FROM pg_policies 
WHERE tablename = 'agents' 
AND policyname LIKE '%Admin%';
```

## Step 4: Restart Your Dev Server 🔄

After running migrations:

```bash
# Stop your dev server (Ctrl+C)
# Then restart:
npm run dev
```

## Troubleshooting

### Error: "column 'is_admin' does not exist"

**Cause**: You skipped Step 1

**Fix**: Run `add_admin_role.sql` migration first

### Error: "permission denied for table agents"

**Cause**: RLS policies are blocking access

**Fix**: Run `add_admin_rls_policies.sql` migration (Step 3)

### Error: "relation 'agents' does not exist"

**Cause**: The `agents` table doesn't exist yet

**Fix**: You need to create the agents table first. Check your mobile app SQL migrations.

### Still Getting 500 Errors?

1. Check Supabase Dashboard → **Logs** → **Postgres Logs** for detailed error messages
2. Verify migrations ran successfully:
   ```sql
   -- Check if column exists
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'agents' AND column_name = 'is_admin';
   
   -- Check if policies exist
   SELECT policyname FROM pg_policies 
   WHERE tablename = 'agents' AND policyname LIKE '%Admin%';
   ```
3. Clear browser cache and cookies
4. Try logging out and logging back in

## Quick Verification Query

Run this to check everything is set up correctly:

```sql
-- Check admin column exists
SELECT 
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name = 'agents'
AND column_name = 'is_admin';

-- Check admin policies exist
SELECT 
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename IN ('agents', 'customer_registrations')
AND policyname LIKE '%Admin%';

-- Check your admin user
SELECT 
  id,
  email,
  name,
  is_admin,
  status
FROM agents
WHERE is_admin = TRUE;
```

You should see:
- ✅ `is_admin` column with `BOOLEAN` type
- ✅ Admin policies for `agents` and `customer_registrations`
- ✅ Your admin user with `is_admin = TRUE`

---

**Run migrations in this order:**
1. ✅ `add_admin_role.sql` (adds column)
2. ✅ Grant admin access (UPDATE query)
3. ✅ `add_admin_rls_policies.sql` (adds policies)
