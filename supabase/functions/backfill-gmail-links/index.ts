// ================================================================================================
// FUNCTION: backfill-gmail-links
//
// WHAT IT DOES:   Re-checks emails that were saved without a client link and links
//                 them to a project if one now matches (by Team tab addresses first,
//                 then by name in the subject or text). Safe to run again: it only
//                 touches emails still unlinked.
//
// CALLED BY:      The Backfill button in Communications.
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member (the app sends the login
//                 token). Anyone else gets 401 or 403 and nothing happens.
//
// READS/CHANGES:  Reads and updates gmail_messages (linked_client_id). Reads the
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

// get-gmail-messages only ever matches a message to a project at import
// time — once a row exists in gmail_messages, nothing ever goes back and
// re-checks it. That leaves two kinds of email permanently unlinked even
// though a match now exists:
//   1. Emails imported before the sender/recipient was added to that
//      project's Team tab.
//   2. Emails imported before this project ever had any Team tab emails
//      (loadProjectRules skips a client entirely until it has at least one).
// This walks every already-imported message with no linked_client_id yet
// and re-runs the exact same matching (participants first, subject/body
// text as a fallback) against the *current* project rules, so anything
// that would match today gets linked retroactively. Safe to re-run — it
// only ever touches rows that are still unlinked.
const PAGE_SIZE = 500;
const MAX_PAGES = 40; // 40 * 500 = up to 20,000 unlinked messages per run

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
    const matchedByClient: Record<string, number> = {};

    // Cursor on `id` rather than an offset/range: as rows get matched they
    // drop out of the `linked_client_id IS NULL` filter mid-scan, so a
    // plain offset would silently skip whatever shifted into that offset
    // between pages. Ordering by id and moving the cursor past the last id
    // seen stays correct regardless of how many rows just got updated.
    let cursor: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      let query = supabase
        .from("gmail_messages")
        .select("id, subject, snippet, body, participants")
        .is("linked_client_id", null)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (cursor) query = query.gt("id", cursor);

      const { data: rows, error } = await query;

      if (error) throw new Error(`Failed to load unlinked messages: ${error.message}`);
      if (!rows || rows.length === 0) break;

      scannedCount += rows.length;
      cursor = rows[rows.length - 1].id;

      const updates: { id: string; linked_client_id: string }[] = [];

      for (const row of rows) {
        const participantEmails = new Set(
          (row.participants || []).map((e: string) => (e || "").toLowerCase().trim()).filter(Boolean)
        );

        let matchedRules = matchProjectRules(projectRules, participantEmails);
        if (matchedRules.length === 0) {
          const text = `${row.subject || ""} ${row.snippet || row.body || ""}`;
          matchedRules = matchProjectRulesByText(projectRules, text);
        }

        if (matchedRules.length > 0) {
          const clientId = matchedRules[0].clientId;
          updates.push({ id: row.id, linked_client_id: clientId });
          matchedByClient[clientId] = (matchedByClient[clientId] || 0) + 1;
        }
      }

      // Supabase has no bulk "update N different rows with N different
      // values" in one call — one update per matched row, in parallel.
      if (updates.length > 0) {
        await Promise.all(
          updates.map((u) =>
            supabase.from("gmail_messages").update({ linked_client_id: u.linked_client_id }).eq("id", u.id)
          )
        );
        matchedCount += updates.length;
      }

      if (rows.length < PAGE_SIZE) break; // last page
    }

    return new Response(JSON.stringify({ scannedCount, matchedCount, matchedByClient }), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("backfill-gmail-links error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: corsHeaders });
  }
});
