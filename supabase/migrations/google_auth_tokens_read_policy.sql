-- Migration: allow reading google_auth_tokens (connection status check)
-- The app checks this table on every page load to know whether Google is
-- still connected, using the anon key like the rest of the app's tables.
-- If this table predates that and never got an anon-readable policy (or has
-- RLS enabled with no SELECT policy at all), that reload check silently
-- fails and the app falls back to showing "disconnected" every time.
--
-- Safe to run regardless of whether this turns out to be the actual cause —
-- the app only ever selects the `email` column from this table, never
-- access_token/refresh_token.
--
-- Run this in the Supabase SQL editor.

alter table public.google_auth_tokens enable row level security;

drop policy if exists "Allow read access to google_auth_tokens" on public.google_auth_tokens;

create policy "Allow read access to google_auth_tokens"
  on public.google_auth_tokens
  for select
  using (true);
