# Admin Account Setup Guide

## Current Authentication

**Important**: Currently, the admin dashboard accepts **any authenticated Supabase user**. There's no admin role checking implemented yet.

This means:
- ✅ Any user with a Supabase Auth account can log in
- ⚠️ You need to create an admin user account in Supabase Auth
- ⚠️ Consider adding admin role checking (see below)

## Option 1: Create Admin User in Supabase (Quick Setup)

### Step 1: Create Admin User via Supabase Dashboard

1. Go to your **Supabase Dashboard**: https://app.supabase.com
2. Select your project
3. Navigate to **Authentication** → **Users**
4. Click **"Add user"** or **"Invite user"**
5. Fill in:
   - **Email**: `admin@airtel.com` (or your admin email)
   - **Password**: Create a strong password
   - **Auto Confirm User**: ✅ Check this (skip email verification)
6. Click **"Create user"**

### Step 2: Log In to Admin Dashboard

1. Go to your admin dashboard login page
2. Use the credentials you just created:
   - **Email**: `admin@airtel.com`
   - **Password**: The password you set

### Step 3: (Optional) Create Admin User via SQL

You can also create an admin user directly via SQL:

```sql
-- This will create a user with email: admin@airtel.com
-- Password will need to be set via dashboard or auth.users table
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  recovery_token
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'admin@airtel.com',
  crypt('your-password-here', gen_salt('bf')), -- Replace with actual password
  NOW(),
  NOW(),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  false,
  '',
  ''
);
```

**⚠️ Note**: Creating users directly via SQL is complex. **Recommended: Use Supabase Dashboard** (Option 1, Step 1).

## Option 2: Add Admin Role Checking (Recommended for Production)

For better security, you should implement admin role checking. Here are two approaches:

### Approach A: Add `is_admin` Column to `agents` Table

1. **Add column to database**:
```sql
-- Add is_admin column to agents table
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- Set specific user(s) as admin
UPDATE agents
SET is_admin = TRUE
WHERE email = 'admin@airtel.com';
```

2. **Update middleware to check admin role**:
```typescript
// lib/supabase/middleware.ts - Add admin check
const { data: { user } } = await supabase.auth.getUser();

if (user) {
  // Check if user is admin
  const { data: agent } = await supabase
    .from('agents')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!agent?.is_admin && request.nextUrl.pathname.startsWith('/dashboard')) {
    // User is not admin - redirect to login or access denied
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
}
```

### Approach B: Use Supabase User Metadata

1. **Set admin flag in user metadata** (via Supabase Dashboard or API):
```typescript
// In Supabase Dashboard → Authentication → Users → Edit user
// Add to user metadata:
{
  "is_admin": true
}
```

2. **Check metadata in middleware**:
```typescript
const { data: { user } } = await supabase.auth.getUser();

if (user && request.nextUrl.pathname.startsWith('/dashboard')) {
  const isAdmin = user.user_metadata?.is_admin === true;
  
  if (!isAdmin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
}
```

### Approach C: Create Separate `admin_users` Table

1. **Create admin_users table**:
```sql
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert admin user
INSERT INTO admin_users (id, email)
SELECT id, email
FROM auth.users
WHERE email = 'admin@airtel.com';
```

2. **Check admin_users table in middleware**

## Quick Start (For Testing)

**Easiest approach right now:**

1. Create an admin user in Supabase Dashboard (Authentication → Users)
2. Use that email/password to log in to the admin dashboard
3. Later, implement admin role checking (Option 2) for production

## Multiple Admin Users

To add multiple admins:

1. **Via Supabase Dashboard**: Create multiple users in Authentication → Users
2. **Via SQL** (if using `is_admin` column):
```sql
UPDATE agents
SET is_admin = TRUE
WHERE email IN ('admin@airtel.com', 'admin2@airtel.com', 'supervisor@airtel.com');
```

## Security Recommendations

1. ✅ **Use strong passwords** for admin accounts
2. ✅ **Enable 2FA** in Supabase for admin users (if available)
3. ✅ **Implement admin role checking** (Option 2) before production
4. ✅ **Use service role key** only in server-side code (API routes, not client)
5. ✅ **Limit admin user count** - only create accounts for authorized personnel
6. ⚠️ **Never commit passwords** or service role keys to git

## Troubleshooting

### Issue: Can't log in even with correct credentials

**Solutions:**
- Check email is confirmed in Supabase (Authentication → Users → Edit user → Auto Confirm)
- Verify password is correct
- Check Supabase Auth is enabled for your project
- Check `.env.local` has correct `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Issue: Regular agents can access admin dashboard

**Solution:**
- This is expected with current setup (no admin checking)
- Implement Option 2 above to add admin role checking
- For now, only share admin credentials with authorized personnel

---

**Next Steps:**
1. Create admin user(s) in Supabase Dashboard
2. Test login with admin credentials
3. (Later) Implement admin role checking for production
