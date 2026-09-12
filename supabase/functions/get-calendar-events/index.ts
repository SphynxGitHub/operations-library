import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";
import { loadProjectRules, matchProjectRules } from "../_shared/project-rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

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

async function listEventsForCalendar(accessToken: string, calendarId: string): Promise<{ items: any[]; error: string | null }> {
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
      return { items, error: message };
    }

    console.log(`[Calendar Sync] "${calendarId}" page ${page + 1}: ${(data.items || []).length} item(s)${data.nextPageToken ? ' (more pages)' : ''}`);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
    page++;
  } while (pageToken && page < MAX_LIST_PAGES);

  return { items, error: null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const accessToken = await getFreshGoogleAccessToken(supabase);
    const [calendarIds, projectRules, calendarSummaries] = await Promise.all([
      getSyncedCalendarIds(supabase),
      loadProjectRules(supabase),
      getCalendarSummaries(accessToken)
    ]);

    const perCalendarResults = await Promise.all(
      calendarIds.map(async (calendarId: string) => ({
        calendarId,
        ...(await listEventsForCalendar(accessToken, calendarId))
      }))
    );

    const parsed: any[] = [];
    const perCalendarSummary: { calendarId: string; summary: string; rawCount: number; error: string | null }[] = [];

    for (const { calendarId, items, error: calError } of perCalendarResults) {
      const calendarSummary = calendarId === "primary" ? "Primary" : (calendarSummaries.get(calendarId) || calendarId);
      perCalendarSummary.push({ calendarId, summary: calendarSummary, rawCount: items.length, error: calError });

      items
        .filter((evt: any) => evt.status !== "cancelled")
        .forEach((evt: any) => {
          const isAllDay = !!evt.start?.date && !evt.start?.dateTime;
          const start = evt.start?.dateTime || (evt.start?.date ? `${evt.start.date}T00:00:00Z` : null);
          if (!start) return; // skip anything with no usable date

          const attendeeEmails = new Set<string>();
          if (evt.organizer?.email) attendeeEmails.add(evt.organizer.email.toLowerCase());
          (evt.attendees || []).forEach((a: any) => { if (a?.email) attendeeEmails.add(a.email.toLowerCase()); });

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

    if (parsed.length === 0) {
      return new Response(JSON.stringify({ syncedCount: 0, newCount: 0, calendarsScanned: calendarIds.length, perCalendar: perCalendarSummary }), { status: 200, headers: corsHeaders });
    }

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
      all_day: r.all_day
    });

    const existingRows = parsed.filter((r) => existingIds.has(r.id)).map(coreFields);
    const newRows = parsed.filter((r) => !existingIds.has(r.id)).map((r) => {
      const matched = matchProjectRules(projectRules, r.attendeeEmails);
      return {
        ...coreFields(r),
        attendee_emails: [...r.attendeeEmails],
        // Only auto-link when exactly one project matches — ambiguous
        // matches are left unlinked rather than guessed.
        linked_client_id: matched.length === 1 ? matched[0].clientId : null,
        automation_processed: false
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

    // New events: plain insert, including the auto-match + fresh automation flag.
    if (newRows.length > 0) {
      for (let i = 0; i < newRows.length; i += 500) {
        const chunk = newRows.slice(i, i + 500);
        const { error } = await supabase.from("calendar_events").insert(chunk);
        if (error) throw new Error(`Insert failed: ${error.message}`);
      }
    }

    return new Response(
      JSON.stringify({ syncedCount: parsed.length, newCount: newRows.length, calendarsScanned: calendarIds.length, perCalendar: perCalendarSummary }),
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
