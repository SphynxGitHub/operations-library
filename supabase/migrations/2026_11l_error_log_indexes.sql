-- Migration: faster Error Tracking
-- The Error Tracking list asks for "this project's errors with this status, newest first" (and the same without a
-- project for the all-projects view). The existing single-column indexes cannot serve that in one step, so the
-- database filtered one column and then sorted the rest. These two composite indexes cover both shapes.
--
-- Run this in the Supabase SQL editor. Safe to run more than once.

create index if not exists error_log_client_status_occurred_idx
  on public.error_log (client_id, status, occurred_at desc);

create index if not exists error_log_status_occurred_idx
  on public.error_log (status, occurred_at desc);
