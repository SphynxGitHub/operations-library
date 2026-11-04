-- Lets the app ask "which projects changed?" cheaply instead of re-downloading every project in full.
-- Adds workspace_clients.updated_at and keeps it current on every insert/update. Safe to run more than once.
-- Until this is run the app keeps working as before (it just downloads every project on its background check).

alter table public.workspace_clients add column if not exists updated_at timestamptz not null default now();

create or replace function public.ol_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ol_workspace_clients_touch on public.workspace_clients;
create trigger ol_workspace_clients_touch
  before insert or update on public.workspace_clients
  for each row execute function public.ol_touch_updated_at();

notify pgrst, 'reload schema';
