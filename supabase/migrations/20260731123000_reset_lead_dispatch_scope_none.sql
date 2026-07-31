-- Enforce default: no inbound leads for existing agents (was 'both' from older default).
UPDATE public.agents
SET lead_dispatch_scope = 'none'
WHERE lead_dispatch_scope IS DISTINCT FROM 'none';
