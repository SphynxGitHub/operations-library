-- Migration: direct Zoom sync
-- Replaces the old add-zoom-summary-webhook flow (which needed you to know
-- and pass eventId/zoomMeetingId by hand from an external Zapier/Make step)
-- with an app-initiated sync, same pattern as Gmail/Calendar: click "Sync
-- Zoom", it pulls recent meeting summaries directly from Zoom's API and
-- matches them to your calendar events automatically.
--
-- Safe to run whether or not you've already run the older calendar_events
-- migrations — everything here is "if not exists" / additive. If you
-- already had zoom_summary/zoom_meeting_id/comments columns from an earlier
-- ad-hoc SQL-editor change, those are no-ops.

-- Where a Zoom OAuth connection's tokens live. Mirrors google_auth_tokens.
create table if not exists public.zoom_auth_tokens (
  email text primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.zoom_auth_tokens enable row level security;

create policy "Allow full access to zoom_auth_tokens"
  on public.zoom_auth_tokens
  for all
  using (true)
  with check (true);

-- Columns on calendar_events used by both the old webhook and the new
-- direct sync.
alter table public.calendar_events add column if not exists zoom_meeting_id text;
alter table public.calendar_events add column if not exists zoom_summary text;
alter table public.calendar_events add column if not exists comments jsonb not null default '[]'::jsonb;

-- Guards against re-creating the same action-item tasks (and re-posting the
-- same summary comment) on every subsequent "Sync Zoom" click, same idea as
-- calendar_events.automation_processed for calendar automations.
alter table public.calendar_events add column if not exists zoom_summary_processed boolean not null default false;

create index if not exists calendar_events_zoom_meeting_id_idx on public.calendar_events (zoom_meeting_id);
