// ================================================================================================
// FUNCTION: zoom-debug-summary
//
// WHAT IT DOES:   Diagnostic only. Asks Zoom directly for one meeting's summary and
//                 returns Zoom's raw answer, to tell a Zoom permission problem from a
//                 calendar-matching problem. Safe to delete when you no longer need
//                 it.
//
// CALLED BY:      You, by hand, with ?meetingId=<Zoom meeting id>.
//
// WHO CAN CALL:   A signed-in admin or team member (login token in the Authorization
//                 header). It returns real meeting text, so it must not be open.
//
// READS/CHANGES:  Reads Zoom only. Changes nothing.
//
// NEEDS:          _shared/zoom-token.ts, _shared/auth.ts. Zoom's meeting:read:summary
//                 permission.
//
// CHANGED FROM THE ORIGINAL: Added the login check. It used to be open to anyone.
// ================================================================================================

// GET /functions/v1/zoom-debug-summary?meetingId=83510317290
//
// Diagnostic only -- calls Zoom's meeting_summary endpoint directly for a
// given meeting id and returns the raw response, bypassing all the
// calendar-event matching in sync-zoom-meetings. Use this to isolate
// whether a "0 summaries posted" result is a Zoom API/scope problem or a
// calendar-matching problem: if this endpoint also comes back empty/404
// for a meeting you know had a summary in Zoom's own UI, the problem is on
// the Zoom API/scope side, not in this app's matching logic.
//
// Safe to delete once you're done debugging -- it doesn't write anything.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFreshZoomAccessToken, ZoomAuthError } from "../_shared/zoom-token.ts";
import { authorizeTeamRequest } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const meetingId = url.searchParams.get("meetingId");
  if (!meetingId) {
    return new Response(JSON.stringify({ error: "Pass ?meetingId=<numeric Zoom meeting id>" }), { status: 400, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Who is calling? This returns the text of real meeting summaries, so it needs a signed-in admin
    // or team member (Authorization: Bearer <login token>), see ../_shared/auth.ts.
    const authz = await authorizeTeamRequest(req, supabase);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error, message: authz.message }), { status: authz.status, headers: corsHeaders });
    }

    const accessToken = await getFreshZoomAccessToken(supabase);

    const instancesRes = await fetch(`https://api.zoom.us/v2/past_meetings/${meetingId}/instances`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const instancesBody = await instancesRes.json().catch(() => null);
    const instances = instancesBody?.meetings || [];

    if (instances.length === 0) {
      return new Response(JSON.stringify({
        requestedMeetingId: meetingId,
        instancesStatus: instancesRes.status,
        instancesResponse: instancesBody,
        note: "No past-meeting instances found for this id -- can't resolve a UUID to look up a summary with."
      }, null, 2), { status: 200, headers: corsHeaders });
    }

    // Same numeric-id-invalid-after-the-fact issue as sync-zoom-meetings --
    // resolve to a UUID first. Debug tool just uses the most recent instance.
    const meetingUuid = instances[instances.length - 1].uuid;
    // Only double-encode when Zoom's docs say to (uuid starts with "/" or
    // contains "//") -- unconditional double-encoding breaks ordinary
    // uuids like "ORqZo6HLQHqkNQw7EtDDIQ==" by over-escaping the "=" signs.
    const needsDoubleEncode = meetingUuid.startsWith("/") || meetingUuid.includes("//");
    const encodedOnce = encodeURIComponent(meetingUuid);
    const encodedUuid = needsDoubleEncode ? encodeURIComponent(encodedOnce) : encodedOnce;

    const summaryRes = await fetch(`https://api.zoom.us/v2/meetings/${encodedUuid}/meeting_summary`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const bodyText = await summaryRes.text();
    let body: any;
    try { body = JSON.parse(bodyText); } catch { body = bodyText; }

    return new Response(JSON.stringify({
      requestedMeetingId: meetingId,
      resolvedUuid: meetingUuid,
      instanceCount: instances.length,
      zoomStatus: summaryRes.status,
      zoomResponse: body
    }, null, 2), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    const isAuthErr = err instanceof ZoomAuthError;
    return new Response(
      JSON.stringify({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }),
      { status: isAuthErr ? 401 : 500, headers: corsHeaders }
    );
  }
});
