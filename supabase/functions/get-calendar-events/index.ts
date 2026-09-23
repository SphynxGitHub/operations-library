// ================================================================================================
// FUNCTION: get-calendar-events
//
// WHAT IT DOES:   The Google Calendar sync. Pulls events from the calendars chosen in
//                 Manage Calendars (180 days back, 365 days ahead), saves and updates
//                 them, links new events to a client project when exactly one matches,
//                 and tags the call type (follow up, intro, coaching, general).
//                 Removes stored events for calendars that are no longer chosen, and
//                 events that were cancelled, declined, deleted or replaced by a
//                 reschedule in Google (see removeStaleEvents).
//
// CALLED BY:      The Sync Calendar button, the app's auto-sync while a tab is open,
//                 and the ol_sync_calendar cron job (every 10 minutes).
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member (the app sends the login
//                 token), or the scheduled sync job, which sends the service role key
//                 or the CRON_SECRET in an x-cron-secret header. Anyone else gets 401
//                 or 403 and nothing happens.
//
// READS/CHANGES:  Reads Google Calendar. Adds, updates and deletes rows in
//                 calendar_events. Reads workspace_masters for the chosen calendars.
//
// NEEDS:          _shared/google-token.ts (the stored Google connection),
//                 _shared/auth.ts, _shared/project-rules.ts.
//
// CHANGED FROM THE ORIGINAL: Added the login check, and acceptance of the scheduled
//                            sync's secret.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";
import { loadProjectRules, matchProjectRules, matchProjectRulesByText } from "../_shared/project-rules.ts"; 

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

// Keyword-based call categorization from an event's subject + description.
// Checked in this order — "follow up" and "intro" are checked before the
// more generic "coaching"/"call" buckets so e.g. "Coaching Follow Up Call"
// lands as Follow Up rather than Coaching. Anything with no keyword match
// but that looks like a call/meeting at all falls to General Call; anything
// that doesn't even look like a call (no call-ish keyword anywhere) is left
// uncategorized (null) rather than forced into General Call.
function classifyCallType(title: string, description: string): string | null {
  const text = `${title || ""} ${description || ""}`.toLowerCase();
  if (/\bfollow[\s-]?up\b/.test(text)) return "Follow Up Call";
  if (/\bintro(ductory)?\b/.test(text)) return "Introductory Call";
  if (/\bcoaching\b/.test(text)) return "Coaching Call";
  if (/\b(call|meeting|check[\s-]?in|sync|consult(ation)?)\b/.test(text)) return "General Call";
  return null;
}

// How far back / forward to sync. Wide enough to cover "historical" without
// pulling your whole calendar history on every run.
const DAYS_BACK = 180;
const DAYS_FORWARD = 365;
const MAX_LIST_PAGES = 10; // safety cap on pagination, per calendar, per sync run
const PAGE_SIZE = 250;

async function getSyncedCalendarIds(supabase: any): Promise<string[]> {
  const { data, error } = await supabase.from("workspace_masters").select("synced_calendar_ids").eq("id", "main_state").maybeSingle();
  if (error) throw new Error(`Failed to load synced calendar list: ${error.message}`);
  const ids = data?.synced_calendar_ids;
  return Array.isArray(ids) && ids.length > 0 ? ids : ["primary"];
}

async function getCalendarSummaries(accessToken: string): Promise<Map<string, string>> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  const map = new Map<string, string>();
  (data.items || []).forEach((c: any) => map.set(c.id, c.summaryOverride || c.summary || c.id));
  return map;
}

async function listEventsForCalendar(accessToken: string, calendarId: string): Promise<{ items: any[]; error: string | null; complete: boolean; timeMin: string; timeMax: string }> {
  const timeMin = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + DAYS_FORWARD * 24 * 60 * 60 * 1000).toISOString();

  const items: any[] = [];
  let pageToken: string | undefined;
  let page = 0;

  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true"); // expands recurring events into instances
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) throw new GoogleAuthError("Google rejected the token while listing events.");
    const data = await res.json();
    if (data.error) {
      // Don't let one bad/removed calendar id kill the whole sync — skip it,
      // but report it back to the caller instead of only logging server-side.
      const message = data.error.message || `HTTP ${res.status}`;
      console.error(`Failed to list events for calendar "${calendarId}": ${message}`);
      return { items, error: message, complete: false, timeMin, timeMax };
    }

    console.log(`[Calendar Sync] "${calendarId}" page ${page + 1}: ${(data.items || []).length} item(s)${data.nextPageToken ? ' (more pages)' : ''}`);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
    page++;
  } while (pageToken && page < MAX_LIST_PAGES);

  // "complete" = Google gave us every event in the window. Only then is it
  // safe to treat a stored event that wasn't returned as deleted.
  return { items, error: null, complete: !pageToken, timeMin, timeMax };
}

// ---- Stale-event cleanup ----
// Google only returns events that still exist, so an event that was cancelled,
// deleted, or replaced by a reschedule (Calendly-style reschedules cancel the
// old event and create a new one) simply stops appearing. Any stored event for
// that calendar, inside the synced window, that Google no longer returns is
// removed here.
//
// Safety:
//   - Only for a calendar whose listing finished with no error and no pages left over.
//   - If Google returned nothing at all but we have more than 25 events stored for that
//     calendar, nothing is removed (looks like a permissions/connection problem, not
//     25 real cancellations) and it's reported instead.
//   - An event that has work attached in the app (a Zoom summary or saved recording, a
//     sent summary email, or comments) is kept and counted, never deleted.
const MAX_BLIND_PURGE = 25;
const hasAppWork = (r: any) =>
  !!(r.zoom_summary && String(r.zoom_summary).trim()) ||
  r.zoom_recording_status === "saved" ||
  !!r.summary_sent_at ||
  (Array.isArray(r.comments) && r.comments.some((c: any) => c && c.author !== "Zoom"));

async function removeStaleEvents(
  supabase: any,
  liveIdsByCalendar: Map<string, { ids: Set<string>; complete: boolean; timeMin: string; timeMax: string }>
): Promise<{ staleRemoved: number; staleKept: number; staleSkippedCalendars: string[] }> {
  let staleRemoved = 0, staleKept = 0;
  const staleSkippedCalendars: string[] = [];

  for (const [calendarId, live] of liveIdsByCalendar) {
    if (!live.complete) { staleSkippedCalendars.push(calendarId); continue; }

    const stored: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("calendar_events").select("id")
        .eq("calendar_id", calendarId).gte("start", live.timeMin).lte("start", live.timeMax)
        .order("id").range(from, from + 999);
      if (error) { console.warn(`Stale check failed for "${calendarId}":`, error.message); stored.length = 0; break; }
      stored.push(...(data || []).map((r: any) => r.id));
      if (!data || data.length < 1000) break;
    }

    const stale = stored.filter((id) => !live.ids.has(id));
    if (!stale.length) continue;
    if (live.ids.size === 0 && stale.length > MAX_BLIND_PURGE) {
      console.warn(`Calendar "${calendarId}" returned no events but ${stale.length} are stored; not removing anything.`);
      staleSkippedCalendars.push(calendarId);
      continue;
    }

    // Small batches: some recurring-event ids are 100+ characters long.
    for (let i = 0; i < stale.length; i += 40) {
      const batch = stale.slice(i, i + 40);
      const { data: rows, error } = await supabase.from("calendar_events").select("*").in("id", batch);
      if (error) { console.warn("Stale event lookup failed:", error.message); continue; }
      const keep = (rows || []).filter(hasAppWork).map((r: any) => r.id);
      const remove = batch.filter((id) => !keep.includes(id));
      staleKept += keep.length;
      if (keep.length) console.log(`Keeping ${keep.length} event(s) gone from Google because they have work attached:`, keep);
      if (remove.length) {
        const { error: delErr } = await supabase.from("calendar_events").delete().in("id", remove);
        if (delErr) console.warn("Stale event delete failed:", delErr.message);
        else staleRemoved += remove.length;
      }
    }
  }
  if (staleRemoved) console.log(`Removed ${staleRemoved} cancelled/deleted/rescheduled event(s).`);
  return { staleRemoved, staleKept, staleSkippedCalendars };
}

// Auth: a signed-in Sphynx admin or team member (Authorization: Bearer <login token>), or the scheduled
// sync calling with the service role key as the bearer token or a CRON_SECRET in the x-cron-secret
// header (see ../_shared/auth.ts). Anyone else gets 401 or 403 and nothing happens.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Who is calling? Nothing else happens until this passes.
    const authz = await authorizeTeamRequest(req, supabase, {
      serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      cronSecret: Deno.env.get("CRON_SECRET")
    });
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error, message: authz.message }), { status: authz.status, headers: corsHeaders });
    }

    const accessToken = await getFreshGoogleAccessToken(supabase);
    const [calendarIds, projectRules, calendarSummaries] = await Promise.all([
      getSyncedCalendarIds(supabase),
      loadProjectRules(supabase),
      getCalendarSummaries(accessToken)
    ]);

    if (calendarIds.length > 0) {
      const formattedIds = calendarIds.map(id => `"${id}"`).join(",");
      const { error: purgeErr } = await supabase
        .from("calendar_events")
        .delete()
        .not("calendar_id", "in", `(${formattedIds})`);
    
      if (purgeErr) {
        console.warn("Failed to purge unsynced calendar events:", purgeErr.message);
      }
    }
    
    const perCalendarResults = await Promise.all(
      calendarIds.map(async (calendarId: string) => ({
        calendarId,
        ...(await listEventsForCalendar(accessToken, calendarId))
      }))
    );

    const parsed: any[] = [];
    const perCalendarSummary: { calendarId: string; summary: string; rawCount: number; error: string | null }[] = [];

    // Per calendar: the ids Google still shows as live, for the stale-event cleanup below.
    const liveIdsByCalendar = new Map<string, { ids: Set<string>; complete: boolean; timeMin: string; timeMax: string }>();

    for (const { calendarId, items, error: calError, complete, timeMin, timeMax } of perCalendarResults) {
      const calendarSummary = calendarId === "primary" ? "Primary" : (calendarSummaries.get(calendarId) || calendarId);
      perCalendarSummary.push({ calendarId, summary: calendarSummary, rawCount: items.length, error: calError });
      const liveIds = new Set<string>();
      liveIdsByCalendar.set(calendarId, { ids: liveIds, complete: !calError && complete, timeMin, timeMax });

      items
        .filter((evt: any) => evt.status !== "cancelled")
        // Events the connected account declined count as cancelled for us.
        .filter((evt: any) => !(evt.attendees || []).some((a: any) => a?.self && a.responseStatus === "declined"))
        .forEach((evt: any) => {
          const isAllDay = !!evt.start?.date && !evt.start?.dateTime;
          const start = evt.start?.dateTime || (evt.start?.date ? `${evt.start.date}T00:00:00Z` : null);
          if (!start) return; // skip anything with no usable date

          const attendeeEmails = new Set<string>();
          if (evt.organizer?.email) attendeeEmails.add(evt.organizer.email.toLowerCase());
          (evt.attendees || []).forEach((a: any) => { if (a?.email) attendeeEmails.add(a.email.toLowerCase()); });

          liveIds.add(`${calendarId}::${evt.id}`);
          parsed.push({
            id: `${calendarId}::${evt.id}`,
            calendar_id: calendarId,
            calendar_summary: calendarSummary,
            title: evt.summary || "Untitled Event",
            description: evt.description || "",
            location: evt.location || "",
            link: evt.htmlLink || "",
            start,
            end: evt.end?.dateTime || (evt.end?.date ? `${evt.end.date}T00:00:00Z` : null),
            all_day: isAllDay,
            attendeeEmails
          });
        });
    }

    const cleanup = await removeStaleEvents(supabase, liveIdsByCalendar);

    if (parsed.length === 0) {
      return new Response(JSON.stringify({ syncedCount: 0, newCount: 0, calendarsScanned: calendarIds.length, perCalendar: perCalendarSummary, ...cleanup }), { status: 200, headers: corsHeaders });
    }

    // Dedupe within this batch itself — Google's API can return the same
    // event twice across pages (events shifting relative to the
    // orderBy=startTime window while paginating), which previously caused
    // "duplicate key" crashes when two identical new rows landed in the
    // same insert. Last occurrence wins.
    const dedupedParsed = [...new Map(parsed.map((r) => [r.id, r])).values()];

    // Figure out which of these events we've already stored, so we only
    // set linked_client_id / automation_processed on genuinely new rows —
    // re-syncing an existing event must never clobber a project match that
    // was already acted on (that's what automation_processed guards).
    //
    // This used to check via .in('id', <up to 200 ids at once>), but some
    // recurring-event instance ids (Reclaim.ai in particular) run 100+
    // characters, and a couple hundred of those joined into one URL blew
    // past the request's practical size limit ("error sending request").
    // Filtering by calendar_id instead keeps every query small regardless
    // of how long individual event ids get.
    const existingIds = new Set<string>();
    for (const calendarId of calendarIds) {
      const { data, error } = await supabase.from("calendar_events").select("id").eq("calendar_id", calendarId);
      if (error) throw new Error(`Lookup failed for calendar "${calendarId}": ${error.message}`);
      (data || []).forEach((r: any) => existingIds.add(r.id));
    }

    const coreFields = (r: any) => ({
      id: r.id,
      calendar_id: r.calendar_id,
      calendar_summary: r.calendar_summary,
      title: r.title,
      description: r.description,
      location: r.location,
      link: r.link,
      start: r.start,
      end: r.end,
      all_day: r.all_day,
      call_type: classifyCallType(r.title, r.description),
      
      // Explicitly map all text[] array columns to valid JavaScript arrays
      attendee_emails: r.attendeeEmails && r.attendeeEmails.size > 0 
        ? Array.from(r.attendeeEmails) 
        : []
      // attendees / assignees are NOT refreshed here. They used to be sent as
      // [] on every sync, which wiped every existing event's assignee list and
      // left only the old single `assignee` column (the first person) behind.
      // They're set once on new events below, then only changed in the app.
    });

    const existingRows = dedupedParsed.filter((r) => existingIds.has(r.id)).map(coreFields);
    const newRows = dedupedParsed.filter((r) => !existingIds.has(r.id)).map((r) => {
      // Attendee-email match first (higher confidence); if that's
      // ambiguous or empty, fall back to the project name appearing in the
      // subject/description — e.g. an internal prep call with no client
      // attendee on it, but "Wealth Innovation Group" right there in the title.
      let matched = matchProjectRules(projectRules, r.attendeeEmails);
      if (matched.length !== 1) {
        const textMatched = matchProjectRulesByText(projectRules, `${r.title} ${r.description}`);
        if (textMatched.length === 1) matched = textMatched;
      }
      return {
        ...coreFields(r),
        attendees: [],
        assignees: [],
        // Only auto-link when exactly one project matches — ambiguous
        // matches are left unlinked rather than guessed.
        linked_client_id: matched.length === 1 ? matched[0].clientId : null,
        automation_processed: false,
        // New events default to non-billable, EXCEPT coaching calls, which
        // are billable by default. Either can be toggled by hand.
        billable: /coaching/i.test(classifyCallType(r.title, r.description) || "")
      };
    });

    // Existing events: refresh core fields only (title/time/location may
    // have changed in Calendar) — linked_client_id/automation_processed are
    // simply not in this payload, so Postgres leaves them untouched.
    if (existingRows.length > 0) {
      for (let i = 0; i < existingRows.length; i += 500) {
        const chunk = existingRows.slice(i, i + 500);
        const { error } = await supabase.from("calendar_events").upsert(chunk, { onConflict: "id" });
        if (error) throw new Error(`Update failed: ${error.message}`);
      }
    }

    // New events: upsert rather than a plain insert — belt-and-suspenders
    // against the same "duplicate key" crash if a row slips past the
    // existingIds check above (e.g. a concurrent sync landing between that
    // check and this write). Safe here since a genuine conflict on a truly
    // new id just means someone else's sync beat us to it.
    if (newRows.length > 0) {
      for (let i = 0; i < newRows.length; i += 500) {
        const chunk = newRows.slice(i, i + 500);
        const { error } = await supabase.from("calendar_events").upsert(chunk, { onConflict: "id" });
        if (error) throw new Error(`Insert failed: ${error.message}`);
      }
    }

    return new Response(
      JSON.stringify({ syncedCount: dedupedParsed.length, newCount: newRows.length, calendarsScanned: calendarIds.length, perCalendar: perCalendarSummary, ...cleanup }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err: any) {
    const isAuthErr = err instanceof GoogleAuthError;
    console.error(isAuthErr ? "Calendar Auth Error:" : "Calendar Sync Error:", err.message);
    return new Response(
      JSON.stringify({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }),
      { status: isAuthErr ? 401 : 500, headers: corsHeaders }
    );
  }
});
