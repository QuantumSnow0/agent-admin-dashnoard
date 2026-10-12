-- Idempotent website retries. Checked read-only on 2026-10-12 before this file
-- was added: 91 inbound_leads rows, 0 null source_external_id values, and 0
-- duplicate (source, source_external_id) pairs. Not applied to production here.
CREATE UNIQUE INDEX IF NOT EXISTS inbound_leads_source_external_id_unique
  ON public.inbound_leads (source, source_external_id)
  WHERE source_external_id IS NOT NULL;
