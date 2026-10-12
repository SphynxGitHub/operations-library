-- Daily digest emails ("Daily digest: ...") are not about one client project.
-- New ones are handled at import (get-gmail-messages). This cleans up the ones already imported:
-- unlink them from any project, archive them in the app only (Gmail is not touched), and lock the links so
-- auto-link and the Backfill button leave them alone.
update public.gmail_messages
set linked_client_id = null,
    archived = true,
    link_locked = true
where subject ~* '^\s*daily digest\s*:'
  and linked_task_id is null and linked_resource_id is null and linked_request_id is null and linked_event_id is null;
