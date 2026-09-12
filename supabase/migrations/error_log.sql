-- Migration: error_log table
-- Centralized error tracking across all client projects, replacing the
-- per-client spreadsheet workflow. Rows can come from three places:
--   'webhook' — a Zap posts directly to the error-webhook function (recommended)
--   'email'   — best-effort parsed out of a synced Zapier-error email
--   'manual'  — added by hand in the app
--
-- Run this in the Supabase SQL editor.

create table if not exists public.error_log (
  id uuid primary key default gen_random_uuid(),
  client_id text,                          -- matched project; null = unassigned, shown for manual triage
  source text not null default 'manual',   -- 'webhook' | 'email' | 'manual'
  title text,
  message text,
  service text,
  history_link text,
  zap_link text,
  root_id text,
  outage boolean,
  occurrence_count integer,
  sheet_id text,                           -- legacy per-client sheet id, if the payload included one
  occurred_at timestamptz not null default now(),
  cause text,
  resolution text,
  status text not null default 'open',     -- 'open' | 'resolved'
  gmail_message_id text,                   -- source email, if this came from the Gmail parser (dedupe guard)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists error_log_client_idx on public.error_log (client_id);
create index if not exists error_log_status_idx on public.error_log (status);
create index if not exists error_log_occurred_at_idx on public.error_log (occurred_at desc);
create unique index if not exists error_log_gmail_message_id_uidx on public.error_log (gmail_message_id) where gmail_message_id is not null;

create or replace function set_error_log_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_error_log_set_updated_at on public.error_log;
create trigger trg_error_log_set_updated_at before update on public.error_log
  for each row execute function set_error_log_updated_at();

alter table public.error_log enable row level security;

create policy "Allow full access to error_log"
  on public.error_log
  for all
  using (true)
  with check (true);
