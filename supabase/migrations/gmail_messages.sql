-- Migration: gmail_messages table
-- Durable store for imported Gmail messages, replacing the old behavior of
-- re-fetching the last N inbox messages live on every page load (which was
-- never actually persisted anywhere). Also adds columns to link an email to
-- a specific client project / task.
--
-- Run this in the Supabase SQL editor before deploying the updated
-- get-gmail-messages function and frontend code.

create table if not exists public.gmail_messages (
  id text primary key,                          -- Gmail message id
  thread_id text,
  sender text,
  subject text,
  snippet text,
  body text,
  date timestamptz,
  imported_at timestamptz not null default now(),
  linked_client_id text,
  linked_task_id text,
  archived boolean not null default false,       -- hidden from the app's inbox feed
  archived_in_gmail boolean not null default false  -- INBOX label actually removed in Gmail
);

create index if not exists gmail_messages_date_idx on public.gmail_messages (date desc);
create index if not exists gmail_messages_linked_task_idx on public.gmail_messages (linked_task_id);
create index if not exists gmail_messages_linked_client_idx on public.gmail_messages (linked_client_id);
create index if not exists gmail_messages_archived_idx on public.gmail_messages (archived);

alter table public.gmail_messages enable row level security;

-- NOTE: this mirrors the permissive/anon-key model the rest of the app
-- already uses (workspace_masters, workspace_clients, etc. are read/written
-- directly from the frontend with the anon key). If you've since locked
-- those down differently, adjust this policy to match rather than leaving
-- this table as the odd one out.
create policy "Allow full access to gmail_messages"
  on public.gmail_messages
  for all
  using (true)
  with check (true);

-- If you already ran an earlier version of this migration without the
-- `archived` column, just run this instead of recreating the table:
--   alter table public.gmail_messages add column if not exists archived boolean not null default false;
--   create index if not exists gmail_messages_archived_idx on public.gmail_messages (archived);
