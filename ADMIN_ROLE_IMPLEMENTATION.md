# Admin Role Implementation

Admin role checking has been implemented in the admin dashboard.

## What Was Implemented

### 1. Database Changes
- ✅ Added `is_admin` column to `agents` table
- ✅ Created index for faster admin lookups
- ✅ Created helper function `is_admin_user(user_id)`

**Migration File**: `supabase/migrations/add_admin_role.sql`

### 2. Authentication & Authorization
- ✅ Middleware checks admin role before allowing dashboard access
- ✅ Login page verifies admin status after authentication
- ✅ Dashboard layout verifies admin status on every page load
- ✅ Error messages shown when non-admin users try to access

### 3. Security
- ✅ Non-admin users are automatically redirected to login
- ✅ Multiple layers of admin verification (middleware, layout, pages)
- ✅ Clear error messages for access denied scenarios

## How to Grant Admin Access

### Option 1: Via Supabase SQL Editor (Recommended)

1. Go to your **Supabase Dashboard** → **SQL Editor**
2. Run this SQL to grant admin access:

```sql
-- Grant admin access to a specific email
UPDATE agents
SET is_admin = TRUE
WHERE email = 'admin@airtel.com';
```

3. Verify the update:
```sql
-- Check admin status
SELECT id, email, name, is_admin
FROM agents
WHERE email = 'admin@airtel.com';
```

### Option 2: Via Supabase Dashboard

1. Go to **Supabase Dashboard** → **Table Editor** → **agents**
2. Find the user you want to make admin
3. Edit the row and set `is_admin` to `TRUE`
4. Save the changes

### Option 3: Grant Multiple Admins

```sql
-- Grant admin to multiple users
UPDATE agents
SET is_admin = TRUE
WHERE email IN (
  'admin@airtel.com',
  'admin2@airtel.com',
  'supervisor@airtel.com'
);
```

## User Flow

### Admin User
1. ✅ Logs in with admin account
2. ✅ Admin status verified in login handler
3. ✅ Redirected to dashboard
4. ✅ Can access all dashboard pages

### Non-Admin User
1. ❌ Tries to log in
2. ❌ Admin status checked → Not admin
3. ❌ Sign out automatically
4. ❌ Error message shown: "Access denied. Admin privileges required."

### Unauthenticated User
1. ❌ Tries to access `/dashboard`
2. ❌ Middleware checks → No user session
3. ❌ Redirected to `/login`

## Security Layers

The admin role checking happens at multiple levels:

1. **Middleware** (`lib/supabase/middleware.ts`)
   - Checks admin status before allowing access to `/dashboard` routes
   - Runs on every request

2. **Login Page** (`app/(auth)/login/page.tsx`)
   - Verifies admin status after successful authentication
   - Prevents non-admins from even starting a session

3. **Dashboard Layout** (`app/dashboard/layout.tsx`)
   - Verifies admin status on every dashboard page load
   - Provides agent data for display

4. **Individual Pages** (e.g., `app/dashboard/page.tsx`)
   - Double-checks admin status as a safety measure

## Database Schema

```sql
-- agents table now includes:
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,  -- NEW COLUMN
  -- ... other columns
);
```

## Helper Functions

### Server-Side Helpers (`lib/utils/admin.ts`)

```typescript
// Check if current user is admin
const isAdmin = await isAdminUser();

// Check if specific user ID is admin
const isAdmin = await isAdminUserById(userId);
```

## Testing

### Test Admin Access
1. Grant admin access to a user:
```sql
UPDATE agents SET is_admin = TRUE WHERE email = 'test@example.com';
```

2. Log in with that user's credentials
3. Should be able to access dashboard

### Test Non-Admin Access
1. Create a user without admin access (default):
```sql
-- User is created with is_admin = FALSE by default
```

2. Try to log in with that user's credentials
3. Should see error: "Access denied. Admin privileges required."

## Migration Steps

If you have an existing Supabase database:

1. **Run the migration SQL**:
   - Go to Supabase Dashboard → SQL Editor
   - Copy and paste contents of `supabase/migrations/add_admin_role.sql`
   - Click "Run"

2. **Grant admin to existing users** (if needed):
```sql
UPDATE agents
SET is_admin = TRUE
WHERE email = 'admin@airtel.com';
```

3. **Restart your admin dashboard**:
```bash
npm run dev
```

## Troubleshooting

### Issue: "Access denied" even though I set is_admin = TRUE

**Solutions:**
- Verify the update worked: `SELECT is_admin FROM agents WHERE email = 'your@email.com';`
- Clear browser cookies and try again
- Check if the user ID matches: `SELECT id, email FROM agents WHERE is_admin = TRUE;`
- Verify you're logging in with the correct email

### Issue: Can't see is_admin column in Supabase Dashboard

**Solution:**
- Make sure you ran the migration SQL
- Refresh the Supabase Dashboard
- Check Table Editor → agents → should see `is_admin` column

### Issue: Migration fails

**Solutions:**
- Check if column already exists: `SELECT column_name FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'is_admin';`
- If exists, skip the ALTER TABLE command
- Check for syntax errors in SQL

## Next Steps

1. ✅ Run the migration SQL in Supabase
2. ✅ Grant admin access to your admin user(s)
3. ✅ Test login with admin account
4. ✅ Verify non-admin users cannot access dashboard

---

**Status**: ✅ Admin role implementation complete
