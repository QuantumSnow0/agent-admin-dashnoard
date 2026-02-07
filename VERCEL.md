# Deploying to Vercel

## 1. Connect the repo

- Push the `admin-dashboard` folder to its own repo, or deploy the monorepo root and set the **Root Directory** to `admin-dashboard` in Vercel.
- In [Vercel](https://vercel.com), import the project and leave **Framework Preset** as Next.js (auto-detected).

## 2. Environment variables

In the Vercel project **Settings → Environment Variables**, add:

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SITE_URL` | Your app’s public URL | Use your Vercel URL, e.g. `https://your-app.vercel.app` |

Apply these to **Production**, and optionally to Preview if you use branch deployments.

## 3. Supabase Auth redirect URLs

After the first deploy, add your Vercel URL to Supabase so login/logout work:

1. Supabase → **Authentication** → **URL Configuration**.
2. Under **Redirect URLs**, add:
   - `https://your-app.vercel.app/**`
   - `https://your-app.vercel.app/login` (if you use a dedicated callback).
3. Set **Site URL** to `https://your-app.vercel.app` (same as `NEXT_PUBLIC_SITE_URL`).

## 4. Deploy

Trigger a deploy (push to the connected branch or **Redeploy** in the Vercel dashboard). The build runs `next build`; no extra config is required.

## Optional: monorepo

If the repo root is above `admin-dashboard`:

- In Vercel project settings, set **Root Directory** to `admin-dashboard`.
- Install and build will run from that directory.
