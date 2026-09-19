// ================================================================================================
// FUNCTION: backfill-calendar-links
//
// WHAT IT DOES:   Re-checks calendar events that were saved without a client link and
//                 links them when exactly one project matches. Events that match more
//                 than one project stay unlinked for a person to choose. Safe to run
//                 again.
//
// CALLED BY:      The Backfill button in the Calendar tab.
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member (the app sends the login
//                 token). Anyone else gets 401 or 403 and nothing happens.
//
// READS/CHANGES:  Reads and updates calendar_events (linked_client_id). Reads the
//                 project rules. Does not contact Google.
//
// NEEDS:          _shared/project-rules.ts, _shared/auth.ts.
//
// CHANGED FROM THE ORIGINAL: Added the login check. Nothing else.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { loadProjectRules, matchProjectRules, matchProjectRulesByText } from "../_shared/project-rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

// get-calendar-events only ever matches an event to a project at import
// time (for genuinely new rows) -- once a row exists, nothing ever goes
// back and re-checks it. That leaves events permanently unlinked even
// after a match now clearly exists:
//   1. Events synced before the attendee/organizer was added to that
//      project's Team tab.
//   2. Events synced before that project had any Team tab emails at all.
//   3. Events that matched TWO OR MORE projects at sync time (ambiguous,
//      so deliberately left unlinked) where one of those projects has
//      since lost its matching Team tab email, leaving only one candidate
//      now.
// This walks every unlinked event and re-runs the same matching (attendee
// emails first, subject/description text as a fallback) against the
// *current* project rules -- same "only auto-link on an exact single
// match" policy as get-calendar-events; still-ambiguous or no-match events
// stay unlinked for a human to pick via the event modal's project picker.
// Safe to re-run.
const PAGE_SIZE = 500;
const MAX_PAGES = 40;

// Auth: a signed-in Sphynx admin or team member (Authorization: Bearer <login token>), see
// ../_shared/auth.ts. Anyone else gets 401 or 403 and nothing happens.
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
    const authz = await authorizeTeamRequest(req, supabase);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error, message: authz.message }), { status: authz.status, headers: corsHeaders });
    }

    const projectRules = await loadProjectRules(supabase);
    if (projectRules.length === 0) {
      return new Response(JSON.stringify({ scannedCount: 0, matchedCount: 0, note: "No projects have any Team tab emails yet." }), { status: 200, headers: corsHeaders });
    }

    let scannedCount = 0;
    let matchedCount = 0;
    let stillAmbiguousCount = 0;
    const matchedByClient: Record<string, number> = {};

    // Cursor on id, not an offset -- rows drop out of the
    // linked_client_id IS NULL filter mid-scan as they get matched, which
    // would make a plain offset silently skip whatever shifted into it.
    let cursor: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      let query = supabase
        .from("calendar_events")
        .select("id, title, description, attendee_emails")
        .is("linked_client_id", null)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (cursor) query = query.gt("id", cursor);

      const { data: rows, error } = await query;

      if (error) throw new Error(`Failed to load unlinked events: ${error.message}`);
      if (!rows || rows.length === 0) break;

      scannedCount += rows.length;
      cursor = rows[rows.length - 1].id;

      const updates: { id: string; linked_client_id: string }[] = [];

      for (const row of rows) {
        const attendeeEmails = new Set(
          (row.attendee_emails || []).map((e: string) => (e || "").toLowerCase().trim()).filter(Boolean)
        );

        let matched = matchProjectRules(projectRules, attendeeEmails);
        if (matched.length !== 1) {
          const textMatched = matchProjectRulesByText(projectRules, `${row.title || ""} ${row.description || ""}`);
          if (textMatched.length === 1) matched = textMatched;
        }

        if (matched.length === 1) {
          const clientId = matched[0].clientId;
          updates.push({ id: row.id, linked_client_id: clientId });
          matchedByClient[clientId] = (matchedByClient[clientId] || 0) + 1;
        } else if (matched.length > 1) {
          stillAmbiguousCount++;
        }
      }

      if (updates.length > 0) {
        await Promise.all(
          updates.map((u) =>
            supabase.from("calendar_events").update({ linked_client_id: u.linked_client_id }).eq("id", u.id)
          )
        );
        matchedCount += updates.length;
      }

      if (rows.length < PAGE_SIZE) break;
    }

    return new Response(JSON.stringify({ scannedCount, matchedCount, stillAmbiguousCount, matchedByClient }), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("backfill-calendar-links error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: corsHeaders });
  }
});
