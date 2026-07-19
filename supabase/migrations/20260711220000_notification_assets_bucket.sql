-- Public bucket for provider logos used in Android push notification large icons.
-- Upload seed files from supabase/storage-seed/wam-notification-assets/ via dashboard or CLI.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wam-notification-assets',
  'wam-notification-assets',
  true,
  524288,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read notification assets" ON storage.objects;
CREATE POLICY "Public read notification assets"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'wam-notification-assets');

DROP POLICY IF EXISTS "Service role upload notification assets" ON storage.objects;
CREATE POLICY "Service role upload notification assets"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'wam-notification-assets');

DROP POLICY IF EXISTS "Service role update notification assets" ON storage.objects;
CREATE POLICY "Service role update notification assets"
ON storage.objects FOR UPDATE
TO service_role
USING (bucket_id = 'wam-notification-assets');
