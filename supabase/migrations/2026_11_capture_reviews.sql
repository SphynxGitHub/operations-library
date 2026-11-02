-- Migration: capture notes, reviews, suggestion log and backward moves
-- Step 1 of the capture / review plan. Run this in the Supabase SQL editor BEFORE deploying the matching code.
-- Safe to run more than once.
--
-- Same access model as the other tables (anon key, permissive policy). Tighten all of them together later
-- rather than leaving these as the odd ones out.

-- 1. One shape for a note. Stored once, referenced from the task, request or resource it belongs to.
create table if not exists public.capture_notes (
  id            text primary key,
  client_id     text not null,
  task_id       text,
  request_id    text,
  resource_id   text,
  author        text,
  type          text not null default 'note',     -- note | email | meeting | system
  visibility    text not null default 'team',     -- team | admin | client
  body          text not null,
  source_kind   text,                             -- email | meeting | manual
  source_id     text,                             -- gmail message id or meeting id
  source_url    text,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);
create index if not exists capture_notes_client_idx   on public.capture_notes (client_id, created_at desc);
create index if not exists capture_notes_task_idx     on public.capture_notes (task_id);
create index if not exists capture_notes_request_idx  on public.capture_notes (request_id);
create index if not exists capture_notes_resource_idx on public.capture_notes (resource_id);
create index if not exists capture_notes_source_idx   on public.capture_notes (source_kind, source_id);

-- 2. A review: what was sent to the client, who sent it, who follows up, and how it ended.
create table if not exists public.reviews (
  id                   text primary key,
  client_id            text not null,
  sheet_id             text,
  round                integer,
  sent_by              text,
  follow_up_owner      text,                      -- the Communications role person
  status               text not null default 'draft',   -- draft | sent | approved | change_requested
  sent_at              timestamptz,
  sent_outside_ol      boolean not null default false,  -- the request was sent from Gmail, then marked as sent
  approved_at          timestamptz,
  change_requested_at  timestamptz,
  summary              text,
  created_at           timestamptz not null default now()
);
create index if not exists reviews_client_idx on public.reviews (client_id, created_at desc);
create index if not exists reviews_status_idx on public.reviews (status);

create table if not exists public.review_items (
  id          text primary key,
  review_id   text not null references public.reviews(id) on delete cascade,
  item_type   text not null,                      -- task | resource | request
  item_id     text not null,
  outcome     text not null default 'pending',    -- pending | approved | change_requested
  note        text,
  decided_at  timestamptz
);
create index if not exists review_items_review_idx on public.review_items (review_id);
create index if not exists review_items_item_idx   on public.review_items (item_type, item_id);

-- 3. Every suggestion the system makes, and what a person did with it. This measures accuracy and feeds the examples.
create table if not exists public.suggestion_log (
  id               text primary key,
  created_at       timestamptz not null default now(),
  client_id        text,
  source_kind      text not null,                 -- email | meeting
  source_id        text,
  suggestion_type  text not null,                 -- change | approval | holding_reply | item_received | new_request | note | ...
  quote            text,
  target_kind      text,
  target_id        text,
  confidence       text,                          -- low | medium | high
  status           text not null default 'pending',  -- pending | accepted | edited | dismissed | manual
  edited_to        jsonb,
  decided_by       text,
  decided_at       timestamptz,
  secrets_removed  integer not null default 0
);
create index if not exists suggestion_log_client_idx on public.suggestion_log (client_id, created_at desc);
create index if not exists suggestion_log_type_idx   on public.suggestion_log (suggestion_type, status);

-- 4. Moving something backward: what changed, why, and the pattern behind it.
create table if not exists public.status_moves (
  id             text primary key,
  created_at     timestamptz not null default now(),
  client_id      text not null,
  item_type      text not null,                   -- resource | task | request
  item_id        text not null,
  from_status    text,
  to_status      text,
  what           text,
  why_category   text,                            -- we_caused_it | asking_for_more | world_changed
  pattern_tag    text,                            -- only for we_caused_it
  asked_by       text,
  source_note_id text,                            -- the email or recap note it was pre-filled from
  moved_by       text
);
create index if not exists status_moves_client_idx  on public.status_moves (client_id, created_at desc);
create index if not exists status_moves_item_idx    on public.status_moves (item_type, item_id);
create index if not exists status_moves_pattern_idx on public.status_moves (pattern_tag);

-- Row level security, matching the other tables.
alter table public.capture_notes  enable row level security;
alter table public.reviews        enable row level security;
alter table public.review_items   enable row level security;
alter table public.suggestion_log enable row level security;
alter table public.status_moves   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['capture_notes','reviews','review_items','suggestion_log','status_moves'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Allow full access to ' || t) then
      execute format('create policy %I on public.%I for all using (true) with check (true)', 'Allow full access to ' || t, t);
    end if;
  end loop;
end $$;
