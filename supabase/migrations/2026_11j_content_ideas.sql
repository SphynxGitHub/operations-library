-- Content ideas: items starred as material for a newsletter, blog post or social post. One row per starred item.
--
-- source_type: manual | app_update (an item from the Dashboard "App updates" digest) | intel (an Intel Library entry)
-- source_key:  identifies the starred item so it cannot be starred twice (unique with source_type); null for manual ideas
-- channels:    any of newsletter, blog, social
-- status:      idea | drafted | published
--
-- Run this in the Supabase SQL editor. Needs public.ol_is_staff() and public.ol_touch_updated_at() (migration 2026_11e).

create table if not exists public.content_ideas (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  details     text,
  source_type text not null default 'manual' check (source_type in ('manual', 'app_update', 'intel')),
  source_key  text,
  source_url  text,
  apps        jsonb not null default '[]'::jsonb,
  channels    text[] not null default '{}',
  status      text not null default 'idea' check (status in ('idea', 'drafted', 'published')),
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists content_ideas_source_uniq on public.content_ideas (source_type, source_key) where source_key is not null;
create index if not exists content_ideas_status_idx on public.content_ideas (status);

drop trigger if exists ol_content_ideas_touch on public.content_ideas;
create trigger ol_content_ideas_touch
  before insert or update on public.content_ideas
  for each row execute function public.ol_touch_updated_at();

alter table public.content_ideas enable row level security;

drop policy if exists "content_ideas staff all" on public.content_ideas;
create policy "content_ideas staff all" on public.content_ideas
  for all to authenticated
  using (public.ol_is_staff()) with check (public.ol_is_staff());
