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
const MAX_LIST_PAGES = 10; // safety cap on pagination for a single sync run
const PAGE_SIZE = 250;

async function listCalendarEvents(accessToken: string): Promise<any[]> {
  const timeMin = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + DAYS_FORWARD * 24 * 60 * 60 * 1000).toISOString();

  const items: any[] = [];
  let pageToken: string | undefined;
  let page = 0;

  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true"); // expands recurring events into instances
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) throw new GoogleAuthError("Google rejected the token while listing events.");
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Failed to fetch calendar events");

    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
    page++;
  } while (pageToken && page < MAX_LIST_PAGES);

  return items;
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
    const [items, projectRules] = await Promise.all([
      listCalendarEvents(accessToken),
      loadProjectRules(supabase)
    ]);

    const parsed = items
      .filter((evt: any) => evt.status !== "cancelled")
      .map((evt: any) => {
        const isAllDay = !!evt.start?.date && !evt.start?.dateTime;
        const attendeeEmails = new Set<string>();
        if (evt.organizer?.email) attendeeEmails.add(evt.organizer.email.toLowerCase());
        (evt.attendees || []).forEach((a: any) => { if (a?.email) attendeeEmails.add(a.email.toLowerCase()); });

        return {
          id: evt.id,
          title: evt.summary || "Untitled Event",
          description: evt.description || "",
          location: evt.location || "",
          link: evt.htmlLink || "",
          start: evt.start?.dateTime || (evt.start?.date ? `${evt.start.date}T00:00:00Z` : null),
          end: evt.end?.dateTime || (evt.end?.date ? `${evt.end.date}T00:00:00Z` : null),
          all_day: isAllDay,
          attendeeEmails
        };
      })
      .filter((r: any) => r.start); // skip anything with no usable date

    if (parsed.length === 0) {
      return new Response(JSON.stringify({ syncedCount: 0, newCount: 0 }), { status: 200, headers: corsHeaders });
    }

    // Figure out which of these events we've already stored, so we only
    // set linked_client_id / automation_processed on genuinely new rows —
    // re-syncing an existing event must never clobber a project match that
    // was already acted on (that's what automation_processed guards).
    const allIds = parsed.map((r: any) => r.id);
    const existingIds = new Set<string>();
    for (let i = 0; i < allIds.length; i += 200) {
      const chunk = allIds.slice(i, i + 200);
      const { data, error } = await supabase.from("calendar_events").select("id").in("id", chunk);
      if (error) throw new Error(`Lookup failed: ${error.message}`);
      (data || []).forEach((r: any) => existingIds.add(r.id));
    }

    const coreFields = (r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      location: r.location,
      link: r.link,
      start: r.start,
      end: r.end,
      all_day: r.all_day
    });

    const existingRows = parsed.filter((r: any) => existingIds.has(r.id)).map(coreFields);
    const newRows = parsed.filter((r: any) => !existingIds.has(r.id)).map((r: any) => {
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
      JSON.stringify({ syncedCount: parsed.length, newCount: newRows.length }),
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
