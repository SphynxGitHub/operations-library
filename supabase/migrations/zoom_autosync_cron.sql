-- Runs the Zoom sync every 15 minutes even when nobody has the app open,
-- the same way ol_sync_gmail runs the Gmail sync.
--
-- BEFORE RUNNING: copy the exact headers your existing ol_sync_gmail job
-- uses (it already authenticates with the CRON_SECRET), with:
--   select command from cron.job where jobname = 'ol_sync_gmail';
-- and replace the headers below to match. Don't commit the real secret.

select cron.unschedule('ol_sync_zoom') where exists (select 1 from cron.job where jobname = 'ol_sync_zoom');

select cron.schedule(
  'ol_sync_zoom',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/sync-zoom-meetings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET — same value ol_sync_gmail uses>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
