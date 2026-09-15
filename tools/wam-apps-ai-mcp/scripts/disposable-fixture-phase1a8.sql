-- Phase 1A.8 synthetic Hub data for 38 exact / 29 installed / 12 unmatched (phones 25471181xxxx)
\set ON_ERROR_STOP on

DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..29 LOOP
    INSERT INTO public.customer_registrations (
      id, agent_id, customer_name, airtel_number, status, created_at
    ) VALUES (
      ('f8f80000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'Synthetic Reg ' || i,
      '25471181' || lpad(i::text, 4, '0'),
      'installed',
      now()
    ) ON CONFLICT (id) DO UPDATE SET airtel_number = EXCLUDED.airtel_number, status = 'installed';
  END LOOP;

  FOR i IN 30..38 LOOP
    INSERT INTO public.inbound_leads (
      id, customer_name, primary_phone, status, product, source, assigned_agent_id
    ) VALUES (
      ('f8f83000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      'Synthetic Lead ' || i,
      '25471181' || lpad(i::text, 4, '0'),
      'assigned',
      'airtel',
      'airtel5grouter',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    ) ON CONFLICT (id) DO UPDATE SET primary_phone = EXCLUDED.primary_phone, status = 'assigned';
  END LOOP;
END $$;
