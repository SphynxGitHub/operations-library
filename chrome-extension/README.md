# OL Time Tracker (Chrome extension)

Start/stop a timer on any Operations Library task from any tab. The toolbar
badge shows elapsed time; stopping logs the time to the task's **Logged
Time** in the portal.

## Install (unpacked, for the team)
1. Run the `time_entries` part of `supabase/migrations/2026_09_ol_fixes.sql` first.
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this `chrome-extension` folder.
3. Pin it, click it, sign in with your OL login (same email/password as the portal).

## How time reaches the task
The extension writes a row to `time_entries`. The portal (any open staff tab)
picks up new rows within ~2 minutes, adds the minutes to the task, records
them in the task's time log, and marks the row applied — so an entry counts
exactly once and the extension never overwrites project data. "Recent" in the
popup shows *syncing to task…* until that happens.

## Details
- Timer survives closing the popup / browser restart (stored locally).
- "Trim" takes minutes off the end if you forgot to stop it.
- Going idle 15+ minutes with a timer running shows a reminder.
- If saving fails (offline, expired sign-in) the entry is queued and retried every minute.
- `config.js` holds the portal URL used by "Open Operations Library".
