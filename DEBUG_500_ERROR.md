# Debugging 500 Error - Admin Check

## How to See Detailed Logs

### 1. Check Browser Console

Open your browser's Developer Tools (F12) and check the **Console** tab. You should see logs like:

```
🔒 [Middleware] Checking admin access for user: xxx
❌ [Middleware] Error checking admin status:
   Error code: ...
   Error message: ...
```

### 2. Check Server Logs (Next.js)

In your terminal where you're running `npm run dev`, you should see logs like:

```
❌ [Middleware] Error checking admin status:
   Error code: PGRST116
   Error message: ...
```

### 3. Check Supabase Logs

1. Go to **Supabase Dashboard** → **Logs** → **Postgres Logs**
2. Filter by error or your user ID
3. Look for detailed error messages

### 4. Check Network Tab

1. Open **Developer Tools** (F12) → **Network** tab
2. Filter by "agents" or "500"
3. Click on the failed request
4. Check the **Response** tab for detailed error

## Common Error Codes

### PGRST116 - No Rows Found
**Meaning**: Agent record doesn't exist for this user

**Solution**:
```sql
-- Check if agent record exists
SELECT id, email, name, is_admin 
FROM agents 
WHERE id = 'your-user-id-here';
```

If no record, create one:
```sql
INSERT INTO agents (id, email, name, status, is_admin)
VALUES ('user-id', 'email@example.com', 'Name', 'approved', TRUE);
```

### 42501 - Permission Denied / RLS Error
**Meaning**: Row Level Security policy is blocking access

**Solution**: Run the admin RLS policies migration:
```sql
-- Run add_admin_rls_policies.sql
```

Then verify:
```sql
SELECT policyname 
FROM pg_policies 
WHERE tablename = 'agents' 
AND policyname LIKE '%Admin%';
```

### 42703 - Undefined Column
**Meaning**: `is_admin` column doesn't exist

**Solution**: Run the admin role migration:
```sql
-- Run add_admin_role.sql
```

## Debug Queries

Run these in Supabase SQL Editor to debug:

### Check if column exists:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'agents'
AND column_name = 'is_admin';
```

### Check if agent record exists:
```sql
-- Replace with your user ID from the error
SELECT id, email, name, status, is_admin
FROM agents
WHERE id = 'your-user-id-here';
```

### Check RLS policies:
```sql
SELECT 
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'agents';
```

### Check if admin policies exist:
```sql
SELECT policyname
FROM pg_policies
WHERE tablename = 'agents'
AND policyname LIKE '%Admin%';
```

### Test admin check query directly:
```sql
-- Replace with your user ID
SELECT is_admin, id, email, status
FROM agents
WHERE id = 'your-user-id-here';
```

If this query fails in SQL Editor, the issue is with RLS policies or the column doesn't exist.

## Step-by-Step Debugging

1. **Check logs** in browser console and terminal
2. **Note the error code** and message
3. **Run debug queries** above in Supabase SQL Editor
4. **Verify**:
   - ✅ Column `is_admin` exists
   - ✅ Agent record exists for your user
   - ✅ `is_admin = TRUE` for your user
   - ✅ Admin RLS policies exist

## Quick Fix Checklist

- [ ] Run `add_admin_role.sql` migration
- [ ] Grant admin access: `UPDATE agents SET is_admin = TRUE WHERE email = 'your@email.com';`
- [ ] Run `add_admin_rls_policies.sql` migration
- [ ] Verify agent record exists for your user
- [ ] Restart dev server: `npm run dev`
- [ ] Clear browser cache and cookies
- [ ] Check logs for detailed error messages
