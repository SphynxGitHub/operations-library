-- =====================================================================
-- OL — September 2026, part 3. Run once (safe to re-run).
-- =====================================================================

-- ---- Coaching calls are billable by default ------------------------------
-- billable_manual = someone toggled the event's $ by hand; defaults (and a
-- later call-type change) never override that.
alter table public.calendar_events add column if not exists billable_manual boolean not null default false;

-- Existing coaching calls: until now every synced event started as
-- non-billable, so these are defaults, not choices. Make them billable.
update public.calendar_events
set billable = true
where call_type ilike '%coaching%'
  and billable is distinct from true
  and billable_manual = false;

-- ---- Zoom → Drive visibility --------------------------------------------
-- Link to the saved recording in Drive, and the last export error (shown
-- on the meeting so a failure is never silent).
alter table public.calendar_events add column if not exists zoom_recording_drive_url text;
alter table public.calendar_events add column if not exists zoom_drive_error text;

-- Retry Drive exports for the last 14 days with the fixed Drive access
-- (Shared Drives + the connected Google account's token).
update public.calendar_events
set zoom_recording_status = null, zoom_summary_in_drive = false
where zoom_meeting_id is not null
  and coalesce(zoom_recording_status, '') <> 'saved'
  and start > now() - interval '14 days';
