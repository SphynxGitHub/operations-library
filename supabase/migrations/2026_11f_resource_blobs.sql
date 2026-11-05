-- Phase 1 of splitting the big project rows (workspace_clients.project_data).
-- localResources is ~93% of all project data. Five heavy fields inside each resource (~10 MB across all projects)
-- move to their own table, so a project row downloads much smaller and the heavy parts are only read when a project is opened:
--     editHistory, emailBody, formDetails, formLogic, formFields
-- (steps, ~14 MB, is a later phase: it is read in 37 files and needs its own plan.)
--
-- This file is NON-DESTRUCTIVE: it creates the table and COPIES the data. project_data is not changed.
-- Safe to run more than once (the copy never overwrites a row that already exists).
-- Run it BEFORE the matching app update is deployed.

create table if not exists public.resource_blobs (
  client_id   text        not null,
  resource_id text        not null,
  blobs       jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (client_id, resource_id)
);

create index if not exists resource_blobs_client_idx on public.resource_blobs (client_id);

-- keep updated_at current (function created by 2026_11e)
drop trigger if exists ol_resource_blobs_touch on public.resource_blobs;
create trigger ol_resource_blobs_touch
  before insert or update on public.resource_blobs
  for each row execute function public.ol_touch_updated_at();

alter table public.resource_blobs enable row level security;

-- Staff can do everything. Anyone else can touch a row only when they can already see its project: the subquery runs under
-- the caller's own rights on workspace_clients, so a partner or client sees exactly the projects they see today.
-- (Row-level write rules for partners/clients are no stricter than that; the planned security pass tightens all tables together.)
drop policy if exists "resource_blobs staff all" on public.resource_blobs;
create policy "resource_blobs staff all" on public.resource_blobs
  for all to authenticated
  using (public.ol_is_staff()) with check (public.ol_is_staff());

drop policy if exists "resource_blobs project access" on public.resource_blobs;
create policy "resource_blobs project access" on public.resource_blobs
  for all to authenticated
  using (exists (select 1 from public.workspace_clients c where c.id = resource_blobs.client_id))
  with check (exists (select 1 from public.workspace_clients c where c.id = resource_blobs.client_id));

-- Copy the heavy fields out of every resource that has any of them.
insert into public.resource_blobs (client_id, resource_id, blobs)
select c.id,
       r->>'id',
       (select jsonb_object_agg(k, r->k)
          from unnest(array['editHistory','emailBody','formDetails','formLogic','formFields']) as k
         where r ? k)
  from public.workspace_clients c,
       jsonb_array_elements(case when jsonb_typeof(c.project_data->'localResources') = 'array'
                                 then c.project_data->'localResources' else '[]'::jsonb end) r
 where r ? 'id'
   and (r ? 'editHistory' or r ? 'emailBody' or r ? 'formDetails' or r ? 'formLogic' or r ? 'formFields')
on conflict (client_id, resource_id) do nothing;

notify pgrst, 'reload schema';

-- Check afterwards (should be roughly 500-1000 rows, ~10 MB):
--   select count(*), pg_size_pretty(sum(length(blobs::text))::bigint) from public.resource_blobs;
