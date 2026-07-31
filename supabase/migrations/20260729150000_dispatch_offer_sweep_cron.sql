-- Periodic offer expiry + re-dispatch (does not depend on agent heartbeats).
-- Requires pg_cron + pg_net. Auth via vault secret `service_role_key` (or
-- `SUPABASE_SERVICE_ROLE_KEY`). Optional vault `project_url`.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  job_id bigint;
  service_key text;
  project_url text;
BEGIN
  FOR job_id IN
    SELECT j.jobid FROM cron.job j WHERE j.jobname = 'dispatch-offer-sweep'
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  BEGIN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name IN ('service_role_key', 'SUPABASE_SERVICE_ROLE_KEY')
    ORDER BY CASE name WHEN 'service_role_key' THEN 0 ELSE 1 END
    LIMIT 1;
  EXCEPTION
    WHEN undefined_table THEN
      service_key := NULL;
    WHEN OTHERS THEN
      service_key := NULL;
  END;

  IF service_key IS NULL OR length(trim(service_key)) = 0 THEN
    RAISE NOTICE
      'dispatch-offer-sweep not scheduled: add vault secret service_role_key, then re-run this migration or schedule manually.';
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
          'Authorization', 'Bearer ' || %L
        ),
        body := jsonb_build_object('source', 'pg_cron', 'at', now())
      );
      $cron$,
      rtrim(project_url, '/'),
      service_key
    )
  );
END $$;
