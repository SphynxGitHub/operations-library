-- Migration: calendar_events table
-- Durable store for synced Google Calendar events (both upcoming and
-- historical), replacing the old behavior of holding only the next ~25
-- upcoming events in memory with nothing persisted.
--
-- Run this in the Supabase SQL editor before deploying the updated
-- get-calendar-events function and frontend code.

create table if not exists public.calendar_events (
  id text primary key,                 -- Google Calendar event id
  title text,
  description text,
  location text,
  link text,
  start timestamptz,
  "end" timestamptz,
  all_day boolean not null default false,
  attendee_emails text[] not null default '{}',
  linked_client_id text,               -- auto-matched project (Team tab emails vs attendees), same idea as gmail_messages
  automation_processed boolean not null default false,  -- guards against re-running task-creation rules on every re-sync
  imported_at timestamptz not null default now()
);

create index if not exists calendar_events_start_idx on public.calendar_events (start);
create index if not exists calendar_events_linked_client_idx on public.calendar_events (linked_client_id);
create index if not exists calendar_events_automation_idx on public.calendar_events (automation_processed);

alter table public.calendar_events enable row level security;

-- Mirrors the same permissive/anon-key model used by gmail_messages and the
-- rest of the app's tables.
create policy "Allow full access to calendar_events"
  on public.calendar_events
  for all
  using (true)
  with check (true);
