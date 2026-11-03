-- Ad hoc purchases can cover hours logged before the purchase date (for example plan period overage the client then paid for).
-- covers_from is optional: blank means the purchase covers time from its purchase date (granted_on) on, as before.
-- Run this BEFORE using the "Covers hours from" field in Maintenance & Hours. Safe to run more than once.

alter table public.hours_grant add column if not exists covers_from date;

notify pgrst, 'reload schema';
