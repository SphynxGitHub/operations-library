-- App updates feed: what the team did with each update on the dashboard card.
--   dismissed  -> hidden from the feed (can be restored)
--   intel      -> added to the Intel Library (intel_id points at the entry)
-- key is the same text the dashboard uses to identify an update: "<app>|<date>|<first 80 chars of the summary>".
--
-- Run this in the Supabase SQL editor. Needs public.ol_is_staff() (migration 2026_11e).

create table if not exists public.app_update_actions (
  key       text primary key,
  action    text not null check (action in ('dismissed', 'intel')),
  intel_id  uuid,
  acted_by  text,
  acted_at  timestamptz not null default now()
);

alter table public.app_update_actions enable row level security;

drop policy if exists "app_update_actions staff all" on public.app_update_actions;
create policy "app_update_actions staff all" on public.app_update_actions
  for all to authenticated
  using (public.ol_is_staff()) with check (public.ol_is_staff());
