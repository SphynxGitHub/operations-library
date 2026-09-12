-- Migration: error_log spreadsheet columns
-- Adds the two columns needed to match the old tracking-sheet layout
-- (Status | Error | Error Date | System | Cause | Resolution | Resolution
-- Date | Additional Notes) that weren't in the original error_log table.
--
-- Run this in the Supabase SQL editor.

alter table public.error_log add column if not exists resolution_date timestamptz;
alter table public.error_log add column if not exists notes text;
