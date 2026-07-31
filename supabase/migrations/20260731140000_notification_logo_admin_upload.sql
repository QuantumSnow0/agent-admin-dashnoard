-- Allow authenticated admins to upload logos for announcements / meetings
-- into the existing public notification assets bucket.

DROP POLICY IF EXISTS "Admins upload notification assets" ON storage.objects;
CREATE POLICY "Admins upload notification assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'wam-notification-assets'
  AND EXISTS (
    SELECT 1 FROM public.agents
    WHERE id = auth.uid() AND is_admin = true
  )
);

DROP POLICY IF EXISTS "Admins update notification assets" ON storage.objects;
CREATE POLICY "Admins update notification assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'wam-notification-assets'
  AND EXISTS (
    SELECT 1 FROM public.agents
    WHERE id = auth.uid() AND is_admin = true
  )
);

DROP POLICY IF EXISTS "Admins delete notification assets" ON storage.objects;
CREATE POLICY "Admins delete notification assets"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'wam-notification-assets'
  AND EXISTS (
    SELECT 1 FROM public.agents
    WHERE id = auth.uid() AND is_admin = true
  )
);
