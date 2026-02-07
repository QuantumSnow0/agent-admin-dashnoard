-- Allow admins to insert into notifications
-- Required when an admin updates an agent's status: the trigger
-- create_account_status_notification() inserts into notifications
-- in the admin's context, so RLS must allow INSERT for admins.

-- Policy: Admins can insert notifications (e.g. from status-change trigger)
CREATE POLICY "Admins can insert notifications"
  ON notifications
  FOR INSERT
  WITH CHECK (is_user_admin(auth.uid()));
