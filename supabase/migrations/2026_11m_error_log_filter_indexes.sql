-- Migration: fast Resource / Service filters on one project's Error Tracking
-- Filtering a single project by resource (or service) asks for "this project, this resource, newest first". With no
-- index that matches, the database can walk every error newest-to-oldest looking for the few that match, which is
-- very slow on a project with few matches. These indexes let it jump straight to them in date order.
--
-- Run this in the Supabase SQL editor. Safe to run more than once.

create index if not exists error_log_client_resource_occurred_idx
  on public.error_log (client_id, resource_name, occurred_at desc);

create index if not exists error_log_client_service_occurred_idx
  on public.error_log (client_id, service, occurred_at desc);

-- Same for the all-projects view, which filters by resource or service without a project.
create index if not exists error_log_resource_occurred_idx
  on public.error_log (resource_name, occurred_at desc);

create index if not exists error_log_service_occurred_idx
  on public.error_log (service, occurred_at desc);

-- Refresh the statistics the database uses to choose a plan.
analyze public.error_log;
