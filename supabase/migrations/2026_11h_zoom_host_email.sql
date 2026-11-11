-- Who hosted a Zoom meeting, taken from its Zoom summary. The "Meeting after-action" task goes to the team member with this email.
alter table public.calendar_events add column if not exists zoom_host_email text;
