-- =====================================================================
-- OL fixes — September 2026. Run once, before deploying the matching
-- code/edge functions. Everything is additive / "if not exists".
-- =====================================================================

-- ---- Email linking --------------------------------------------------
-- linked_request_id: emails can be linked to a request (the app already
--   read this column; now it saves it too).
-- link_locked: a person set or cleared this email's links by hand, so
--   auto-link and the project backfill must never change them again
--   (this is what stops a de-link from being undone on the next load).
-- note_html: rich-text version of the linked-email note (note keeps the
--   plain-text copy).
alter table public.gmail_messages add column if not exists linked_request_id text;
alter table public.gmail_messages add column if not exists link_locked boolean not null default false;
alter table public.gmail_messages add column if not exists note_html text;
create index if not exists gmail_messages_thread_idx on public.gmail_messages (thread_id);
create index if not exists gmail_messages_linked_request_idx on public.gmail_messages (linked_request_id);

-- ---- Billable rules -------------------------------------------------
alter table public.workspace_masters add column if not exists billable_rules jsonb not null default '[]'::jsonb;

-- ---- Zoom sync -------------------------------------------------------
-- The sync now stores action items on the event and the app turns them
-- into tasks; Drive exports are tracked (and retried) separately.
alter table public.calendar_events add column if not exists zoom_action_items jsonb not null default '[]'::jsonb;
alter table public.calendar_events add column if not exists zoom_tasks_created boolean not null default false;
alter table public.calendar_events add column if not exists zoom_meeting_uuid text;
alter table public.calendar_events add column if not exists zoom_summary_in_drive boolean not null default false;
alter table public.calendar_events add column if not exists zoom_recording_status text; -- null = pending, 'saved', 'none'

-- Meetings the OLD sync already handled and that DID get their tasks:
-- mark them done so nothing is created twice.
update public.calendar_events e
set zoom_tasks_created = true
where e.zoom_summary_processed = true
  and exists (
    select 1
    from public.workspace_clients c,
         jsonb_array_elements(coalesce(c.project_data->'clientTasks', '[]'::jsonb)) t
    where c.id = e.linked_client_id
      and t->>'linkedEventId' = e.id::text
  );

-- Meetings from the last 30 days that the old sync marked "processed"
-- but that never got tasks (e.g. the meeting wasn't linked to a project
-- yet when the summary arrived — the Brandon Gomez call): re-run them.
-- The summary comment isn't duplicated (the sync checks for it).
update public.calendar_events
set zoom_summary_processed = false
where zoom_summary_processed = true
  and zoom_tasks_created = false
  and zoom_meeting_id is not null
  and start > now() - interval '30 days';

-- Anything older than that is left as-is.
update public.calendar_events
set zoom_tasks_created = true
where zoom_summary_processed = true
  and zoom_tasks_created = false
  and start <= now() - interval '30 days';

-- ---- Email templates (compose window) --------------------------------
alter table public.workspace_masters add column if not exists email_templates jsonb not null default '[]'::jsonb;

-- ---- Meeting agendas ----------------------------------------------------
-- { items: [{ id, text, done, source? }], notes, sentAt }
alter table public.calendar_events add column if not exists agenda jsonb;

-- ---- Time entries from the Chrome extension ----------------------------
-- The extension never edits project data directly (that would race the
-- app's own saves). It writes rows here; the app adds each entry to its
-- task's logged time and marks it applied.
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                       -- Supabase Auth user who logged it
  user_name text,
  client_id text not null,
  task_id text not null,
  task_title text,
  started_at timestamptz,
  ended_at timestamptz,
  minutes numeric not null check (minutes > 0 and minutes <= 1440),
  note text,
  source text not null default 'chrome_extension',
  applied boolean not null default false,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists time_entries_pending_idx on public.time_entries (applied) where applied = false;
create index if not exists time_entries_user_idx on public.time_entries (user_id, created_at desc);

alter table public.time_entries enable row level security;
-- Signed-in people only (the extension always signs in). Tighten in the
-- planned security pass along with the other tables.
create policy "Signed-in users can read time entries" on public.time_entries
  for select to authenticated using (true);
create policy "Signed-in users add their own time entries" on public.time_entries
  for insert to authenticated with check (user_id = auth.uid());
create policy "Signed-in users update time entries" on public.time_entries
  for update to authenticated using (true) with check (true);
