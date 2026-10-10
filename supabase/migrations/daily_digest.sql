-- Daily digest: a log so nobody gets two in one day, and the 7am schedule.
-- Run this in the Supabase SQL editor (after deploying the send-daily-digest function).

create table if not exists public.daily_digest_log (
  digest_date date not null,
  member_key  text not null,
  sent_at     timestamptz not null default now(),
  primary key (digest_date, member_key)
);
alter table public.daily_digest_log enable row level security;   -- only the service role (the function) touches it

-- The function sends only when it is 7am in America/New_York and it is a weekday. pg_cron runs in UTC, and 7am New York is
-- 11:00 UTC in summer time and 12:00 UTC in winter time, so it is scheduled at both and the function ignores the wrong one.
--
-- BEFORE RUNNING: copy the exact headers your existing ol_sync_gmail job uses (it already authenticates with the
-- CRON_SECRET), with:
--   select command from cron.job where jobname = 'ol_sync_gmail';
-- and replace the headers below to match. Don't commit the real secret.

select cron.unschedule('ol_daily_digest') where exists (select 1 from cron.job where jobname = 'ol_daily_digest');

select cron.schedule(
  'ol_daily_digest',
  '0 11,12 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/send-daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET — same value ol_sync_gmail uses>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- To preview without sending (run from a terminal with your secret):
--   curl -X POST https://<project>.supabase.co/functions/v1/send-daily-digest \
--     -H "x-cron-secret: <CRON_SECRET>" -H "Content-Type: application/json" -d '{"dryRun": true, "force": true}'
