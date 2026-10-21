-- Outbox for the Airtel 5G customer SMS sent after an agent accepts a lead.
-- The row is inserted in the same transaction as the assignment update.
-- Any failure inside the enqueue function is caught so it cannot roll back that update.
-- A worker sends it later. Acceptance never waits on Onfon.

CREATE TABLE IF NOT EXISTS public.customer_assignment_sms_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL UNIQUE REFERENCES public.lead_offers(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.inbound_leads(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed', 'ambiguous')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  send_started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  template_variant TEXT
    CHECK (template_variant IS NULL OR template_variant IN ('one_number', 'two_numbers')),
  skip_reason TEXT,
  error_category TEXT,
  provider_message_id TEXT,
  provider_error_code INTEGER
);

CREATE INDEX IF NOT EXISTS idx_customer_assignment_sms_pending
  ON public.customer_assignment_sms_outbox (created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.customer_assignment_sms_outbox IS
  'One row per accepted Airtel 5G offer. Provider accept means Onfon accepted the SMS, not handset delivery.';

ALTER TABLE public.customer_assignment_sms_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_assignment_sms_outbox FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_customer_assignment_sms()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer_id UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM 'assigned' OR NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'assigned'
     AND OLD.assigned_agent_id IS NOT DISTINCT FROM NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;
  IF NEW.source IS DISTINCT FROM 'airtel5grouter'
     OR NEW.plan_group IS DISTINCT FROM '5G' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT o.id
      INTO v_offer_id
    FROM public.lead_offers o
    WHERE o.lead_id = NEW.id
      AND o.agent_id = NEW.assigned_agent_id
      AND o.status = 'accepted'
    ORDER BY o.responded_at DESC NULLS LAST, o.created_at DESC
    LIMIT 1;

    IF v_offer_id IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.customer_assignment_sms_outbox (offer_id, lead_id, agent_id)
    VALUES (v_offer_id, NEW.id, NEW.assigned_agent_id)
    ON CONFLICT (offer_id) DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      -- The offer lookup and the outbox insert are both notification work.
      -- Either one failing must not roll back the assignment.
      -- SQLSTATE only: the message can contain row data.
      RAISE WARNING 'enqueue_customer_assignment_sms skipped: %', SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_customer_assignment_sms ON public.inbound_leads;
CREATE TRIGGER enqueue_customer_assignment_sms
  AFTER UPDATE OF status, assigned_agent_id ON public.inbound_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_customer_assignment_sms();

CREATE OR REPLACE FUNCTION public.claim_customer_assignment_sms(batch_size INTEGER DEFAULT 15)
RETURNS SETOF public.customer_assignment_sms_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.customer_assignment_sms_outbox AS o
  SET status = 'sending',
      claimed_at = NOW(),
      attempt_count = o.attempt_count + 1,
      updated_at = NOW()
  WHERE o.id IN (
    SELECT q.id
    FROM public.customer_assignment_sms_outbox q
    WHERE q.status = 'pending'
      AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= NOW())
    ORDER BY q.created_at
    LIMIT GREATEST(1, LEAST(COALESCE(batch_size, 15), 50))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_customer_assignment_sms_claims()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_step INTEGER := 0;
BEGIN
  -- Died before the Onfon call. The message was not submitted, so it can be claimed again.
  UPDATE public.customer_assignment_sms_outbox
  SET status = 'pending',
      claimed_at = NULL,
      error_category = 'claim_expired_before_send',
      next_attempt_at = NOW(),
      updated_at = NOW()
  WHERE status = 'sending'
    AND send_started_at IS NULL
    AND claimed_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_step = ROW_COUNT;
  v_count := v_step;

  -- The Onfon call may already have been submitted. Do not send it again.
  UPDATE public.customer_assignment_sms_outbox
  SET status = 'ambiguous',
      error_category = 'claim_expired_unconfirmed',
      updated_at = NOW()
  WHERE status = 'sending'
    AND send_started_at IS NOT NULL
    AND claimed_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_step = ROW_COUNT;
  RETURN v_count + v_step;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_customer_assignment_sms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_customer_assignment_sms(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_customer_assignment_sms_claims() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_customer_assignment_sms(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_customer_assignment_sms_claims() TO service_role;

-- Wake the worker every minute. Pending rows survive if a run is missed.
DO $$
DECLARE
  job_id bigint;
  service_key text;
  project_url text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'customer-assignment-sms not scheduled: pg_cron is not installed.';
    RETURN;
  END IF;

  FOR job_id IN
    SELECT j.jobid FROM cron.job j WHERE j.jobname = 'customer-assignment-sms'
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
      'customer-assignment-sms not scheduled: add vault secret service_role_key, then re-run this migration or schedule manually.';
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
    'customer-assignment-sms',
    '* * * * *',
    format(
      $cron$
      SELECT net.http_post(
        url := %L || '/functions/v1/process-customer-assignment-sms',
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
