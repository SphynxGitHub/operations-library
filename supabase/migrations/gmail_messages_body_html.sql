-- Migration: gmail_messages.body_html
-- The original gmail_messages table only stores a plain-text `body`
-- (get-gmail-messages/index.ts's extractPlainTextBody() strips every HTML
-- tag on the way in), which is why imported emails never rendered any
-- formatting — there was no formatted version to render. This adds a
-- separate `body_html` column for the message's original HTML part, left
-- null for plain-text-only emails. Existing rows are unaffected (backfilled
-- as null) — only emails synced after this migration + the matching
-- get-gmail-messages update will have it populated.

alter table public.gmail_messages add column if not exists body_html text;
