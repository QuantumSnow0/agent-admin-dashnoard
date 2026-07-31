-- Schedule dispatch-sweep using vault `inbound_lead_api_key` when service_role_key is absent.
-- Auth header: x-inbound-api-key (matches dispatch-sweep verifyAccess).

DO $$
DECLARE
  job_id bigint;
  api_key text;
  project_url text;
  already boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dispatch-offer-sweep'
  ) INTO already;

  IF already THEN
    RAISE NOTICE 'dispatch-offer-sweep already scheduled';
    RETURN;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO api_key
    FROM vault.decrypted_secrets
    WHERE name IN ('inbound_lead_api_key', 'INBOUND_LEAD_API_KEY')
    ORDER BY CASE name WHEN 'inbound_lead_api_key' THEN 0 ELSE 1 END
    LIMIT 1;
  EXCEPTION
    WHEN undefined_table THEN
      api_key := NULL;
    WHEN OTHERS THEN
      api_key := NULL;
  END;

  IF api_key IS NULL OR length(trim(api_key)) = 0 THEN
    RAISE NOTICE
      'dispatch-offer-sweep still not scheduled: store vault secret inbound_lead_api_key (same value as edge INBOUND_LEAD_API_KEY), then re-run.';
    RETURN;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO project_url
    FROM vault.decrypted_secrets
    WHERE name = 'project_url'
    LIMIT 1;
  EXCEPTION
    WHEN OTHERS THEN
      project_url := NULL;
  END;

  IF project_url IS NULL OR length(trim(project_url)) = 0 THEN
    project_url := 'https://olaounggwgxpbenmuvnl.supabase.co';
  END IF;

  PERFORM cron.schedule(
    'dispatch-offer-sweep',
    '*/2 * * * *',
    format(
      $cron$
      SELECT net.http_post(
        url := %L || '/functions/v1/dispatch-sweep',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-inbound-api-key', %L
        ),
        body := jsonb_build_object('source', 'pg_cron', 'at', now())
      );
      $cron$,
      rtrim(project_url, '/'),
      api_key
    )
  );

  RAISE NOTICE 'dispatch-offer-sweep scheduled via inbound_lead_api_key';
END $$;
