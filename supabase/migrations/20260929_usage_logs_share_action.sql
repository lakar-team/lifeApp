-- Allow 'share' events in usage_logs (sent by the Share button on /tools via /api/track).
-- Run once in the Supabase SQL Editor.
alter table usage_logs drop constraint if exists usage_logs_action_check;
alter table usage_logs add constraint usage_logs_action_check
  check (action in ('launch', 'heartbeat', 'close', 'share'));
