-- One push delivery per notification row (webhook + direct invoke dedupe).

CREATE TABLE IF NOT EXISTS public.notification_push_receipts (
  notification_id UUID PRIMARY KEY
    REFERENCES public.notifications(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_push_receipts IS
  'Prevents duplicate Expo pushes when both DB webhook and dispatch invoke send-push-notification.';

ALTER TABLE public.notification_push_receipts ENABLE ROW LEVEL SECURITY;
