-- Migration: error_log resource association
-- Lets each error link to a specific resource (e.g. a specific Zap) within
-- its project, not just the project itself. Auto-matched by finding a
-- resource whose External Link contains the error's Root ID (Zapier's
-- root_id appears in both the Zap's editor URL and the error payload).
--
-- Run this in the Supabase SQL editor.

alter table public.error_log add column if not exists resource_id text;
alter table public.error_log add column if not exists resource_name text;

create index if not exists error_log_resource_idx on public.error_log (resource_id);
