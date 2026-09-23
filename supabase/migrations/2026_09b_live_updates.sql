-- =====================================================================
-- OL — September 2026, part 2. Run once (safe to re-run).
-- =====================================================================

-- ---- Live updates (Supabase Realtime) --------------------------------
-- Lets open tabs see other people's changes (and background syncs) without
-- a page refresh. Adds the tables to Supabase's realtime publication.
do $$
declare t text;
begin
  foreach t in array array['workspace_clients','workspace_masters','gmail_messages','calendar_events','error_log'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- already added
      when undefined_object then raise notice 'Publication supabase_realtime not found — enable Realtime in the dashboard first.';
    end;
  end loop;
end $$;

-- ---- Zoom: link to the recording in Zoom (used in summary emails) -----
alter table public.calendar_events add column if not exists zoom_recording_url text;
