-- Distinguishes messages sent from inside this app (via send-gmail-message)
-- from ones picked up by the normal inbox/sent sync, so the UI can show a
-- "Sent" badge and so the send function's own local-insert (which happens
-- immediately, ahead of the next Gmail sync) doesn't get treated as
-- ambiguous with a synced copy.
alter table public.gmail_messages add column if not exists sent_via_app boolean not null default false;
