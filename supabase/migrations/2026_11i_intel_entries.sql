-- Intel Library: what Sphynx has learned about apps, common requests and common errors, so a prospect's apps can be turned into
-- recommendations and a "gotchas" list. One row per piece of intel; an entry can be tagged to one or more apps.
--
-- kind:        gotcha | recommendation | common_request | common_error | note
-- apps:        [{ "id": "<master app id or null>", "name": "Wealthbox" }]  (name is kept so an entry still reads right if an app is renamed or removed)
-- source_*:    where the entry was made from: manual (Intel Library), app (an app's page), error (Error Tracking), task
--
-- Run this in the Supabase SQL editor. Needs public.ol_is_staff() and public.ol_touch_updated_at() (migration 2026_11e).

create table if not exists public.intel_entries (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'gotcha'
                check (kind in ('gotcha', 'recommendation', 'common_request', 'common_error', 'note')),
  title         text not null,
  details       text,
  how_to_avoid  text,
  apps          jsonb not null default '[]'::jsonb,
  source_type   text not null default 'manual' check (source_type in ('manual', 'app', 'error', 'task')),
  source_id     text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists intel_entries_kind_idx on public.intel_entries (kind);
create index if not exists intel_entries_apps_idx on public.intel_entries using gin (apps);
create index if not exists intel_entries_source_idx on public.intel_entries (source_type, source_id);

drop trigger if exists ol_intel_entries_touch on public.intel_entries;
create trigger ol_intel_entries_touch
  before insert or update on public.intel_entries
  for each row execute function public.ol_touch_updated_at();

alter table public.intel_entries enable row level security;

-- Internal knowledge: staff only.
drop policy if exists "intel_entries staff all" on public.intel_entries;
create policy "intel_entries staff all" on public.intel_entries
  for all to authenticated
  using (public.ol_is_staff()) with check (public.ol_is_staff());
