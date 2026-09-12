-- Migration: multi-calendar support
-- Adds the ability to sync more than one Google Calendar, not just "primary".
-- Run this in the Supabase SQL editor. Safe to run whether or not you've
-- already run the earlier calendar_events.sql — everything here is
-- "if not exists" / additive.

-- Which calendar an event came from, and its display name (e.g. "Coaching
-- Calendar", "Personal").
alter table public.calendar_events add column if not exists calendar_id text;
alter table public.calendar_events add column if not exists calendar_summary text;

create index if not exists calendar_events_calendar_id_idx on public.calendar_events (calendar_id);

-- Which of your Google Calendars to sync. Stored as a JSON array of Google
-- calendar ids, e.g. ["primary", "someone@group.calendar.google.com"].
-- Defaults to empty, which the sync function treats as "just primary".
alter table public.workspace_masters add column if not exists synced_calendar_ids jsonb not null default '[]'::jsonb;

-- IMPORTANT — only relevant if you already ran a sync with the earlier
-- single-calendar version of get-calendar-events: those rows used the raw
-- Google event id as their primary key. Going forward, events are stored
-- with a composite id ("<calendarId>::<eventId>") so the same event id
-- from two different calendars can't collide. That means old rows won't
-- match up with the new ones and will look like stale duplicates. If you
-- already synced before this migration, it's cleanest to clear the table
-- and let the next sync repopulate it from scratch:
--   truncate table public.calendar_events;
