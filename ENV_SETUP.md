# Environment Variables Setup

## Required Environment Variables

Create a `.env.local` file in the `admin-dashboard` root directory with the following variables:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Optional: Service Role Key (for server-side admin operations)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

## How to Get Your Supabase Credentials

### Step 1: Go to Supabase Dashboard

1. Visit [https://app.supabase.com](https://app.supabase.com)
2. Log in to your account
3. Select your Airtel Agents project (or create a new one)

### Step 2: Get Project URL and Anon Key

1. In your Supabase project, go to **Settings** → **API**
2. Find the following values:

   - **Project URL**
     - Location: Under "Project URL" section
     - Format: `https://xxxxxxxxxxxxx.supabase.co`
     - Use for: `NEXT_PUBLIC_SUPABASE_URL`

   - **anon public key**
     - Location: Under "Project API keys" → "anon public"
     - Format: Long JWT token starting with `eyJ...`
     - Use for: `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Step 3: Get Service Role Key (Optional)

1. In the same **Settings** → **API** page
2. Find **service_role key**
   - Location: Under "Project API keys" → "service_role" (secret)
   - Format: Long JWT token starting with `eyJ...`
   - Use for: `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ **WARNING**: Keep this secret! Never commit it to git or expose it to the client

## Step 4: Create `.env.local` File

1. In the `admin-dashboard` directory, create a file named `.env.local`
2. Copy the template above and fill in your values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYxNjIxOTAyMiwiZXhwIjoxOTMxNzk1MDIyfQ.example-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjE2MjE5MDIyLCJleHAiOjE5MzE3OTUwMjJ9.example-service-role-key
```

## Important Notes

- ✅ **`.env.local` is automatically gitignored** - your keys won't be committed
- ✅ **Use `NEXT_PUBLIC_` prefix** for client-side environment variables
- ✅ **Restart dev server** after creating/updating `.env.local`: `npm run dev`
- ⚠️ **Never commit `.env.local`** to git (it's already in `.gitignore`)
- ⚠️ **Never expose `SUPABASE_SERVICE_ROLE_KEY`** in client-side code

## Variable Explanations

### `NEXT_PUBLIC_SUPABASE_URL` (Required)
- **Purpose**: Your Supabase project URL
- **Used by**: Client and server components for database access
- **Security**: Public (safe to expose to client)

### `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Required)
- **Purpose**: Supabase anonymous/public key
- **Used by**: Client and server components for database access
- **Security**: Public (safe to expose, respects RLS policies)

### `SUPABASE_SERVICE_ROLE_KEY` (Optional)
- **Purpose**: Supabase service role key (bypasses RLS)
- **Used by**: Server-side operations that need admin access
- **Security**: **SECRET** - Only use in API routes or server components
- **Note**: Only needed for operations that bypass Row Level Security

## Verify Setup

After creating `.env.local`:

1. **Restart dev server**:
   ```bash
   npm run dev
   ```

2. **Check console**: Should not show empty Supabase URL errors

3. **Test login**: Try logging in to verify connection

## Troubleshooting

### Issue: "Supabase URL is empty" or connection errors

**Solutions:**
- Check `.env.local` file exists in `admin-dashboard` root
- Verify variable names start with `NEXT_PUBLIC_` (for client-side vars)
- Check for typos in variable names
- Restart dev server: `npm run dev`

### Issue: Authentication not working

**Solutions:**
- Verify `NEXT_PUBLIC_SUPABASE_URL` is correct
- Verify `NEXT_PUBLIC_SUPABASE_ANON_KEY` is correct
- Check that your Supabase project has Auth enabled
- Ensure RLS policies are configured correctly

### Issue: Service role key not working

**Solutions:**
- Verify `SUPABASE_SERVICE_ROLE_KEY` is correct (no extra spaces)
- Only use service role key in server-side code (API routes, server components)
- Never use service role key in client components

---

## Using Same Supabase Project as Mobile App

If you're using the **same Supabase project** as the mobile app:

- ✅ Use the **same Project URL** (just with `NEXT_PUBLIC_` prefix instead of `EXPO_PUBLIC_`)
- ✅ Use the **same anon key** (just with `NEXT_PUBLIC_` prefix instead of `EXPO_PUBLIC_`)
- ✅ Database tables are shared between mobile app and admin dashboard

Example:
```env
# Mobile app (.env)
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Admin dashboard (.env.local)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co  # Same URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...                 # Same key
```
