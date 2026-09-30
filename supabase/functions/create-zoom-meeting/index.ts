// ================================================================================================
// FUNCTION: create-zoom-meeting
//
// WHAT IT DOES:   Creates a scheduled meeting on the connected Zoom account and returns its join link,
//                 meeting ID and passcode. The Calendar tab's "New meeting" window calls this first, then
//                 hands the link to create-calendar-event so it appears in the invitation.
//
// CALLED BY:      The "New meeting" button on the Calendar tab (when "Create a Zoom meeting" is ticked).
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member. Anyone else gets 401 or 403.
//
// READS/CHANGES:  Zoom: adds one meeting. Nothing in the database (it only reads the stored Zoom connection).
//
// NEEDS:          _shared/zoom-token.ts, _shared/auth.ts. The Zoom app must have the scope
//                 meeting:write:meeting (granular) — or meeting:write for a classic-scope app — added in the
//                 Zoom App Marketplace, and Zoom must be reconnected once after adding it (Calendar tab >
//                 Connect Zoom), because the scopes on the stored connection are fixed when it is made.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { getFreshZoomAccessToken, ZoomAuthError } from "../_shared/zoom-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const LOCAL_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authz = await authorizeTeamRequest(req, supabase);
    if (!authz.ok) return json({ error: authz.error, message: authz.message }, authz.status);

    const body = await req.json();
    const topic = String(body?.title || "").trim().slice(0, 200);
    const start = String(body?.start || "");   // local date-time, e.g. 2026-10-05T14:00
    const minutes = Math.round(Number(body?.durationMinutes));
    const timeZone = String(body?.timeZone || "America/New_York");
    const agenda = String(body?.agenda || "").slice(0, 2000);

    if (!topic) return json({ error: "bad_request", message: "Give the meeting a title." }, 400);
    if (!LOCAL_DT_RE.test(start)) return json({ error: "bad_request", message: "Pick a start date and time." }, 400);
    if (!(minutes >= 5 && minutes <= 720)) return json({ error: "bad_request", message: "Length must be between 5 minutes and 12 hours." }, 400);
    if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) return json({ error: "bad_request", message: "Unknown time zone." }, 400);

    const accessToken = await getFreshZoomAccessToken(supabase);
    const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        type: 2,   // scheduled meeting
        start_time: start.length === 16 ? `${start}:00` : start,   // local time; Zoom applies timezone below
        duration: minutes,
        timezone: timeZone,
        agenda,
        settings: { join_before_host: false, waiting_room: true },
      }),
    });

    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const detail = await res.json().catch(() => ({}));
      const scopeProblem = /scope/i.test(String(detail?.message || ""));
      // A 401 that is not about scopes is a dead connection; a scope complaint (Zoom sends it as 400, 401 or 403) is a missing permission.
      if (res.status === 401 && !scopeProblem) return json({ error: "reauth_required", message: "Zoom rejected the connection. Reconnect Zoom on the Calendar tab." }, 401);
      return json({
        error: scopeProblem ? "insufficient_scope" : "zoom_refused",
        message: scopeProblem
          ? "Zoom did not allow creating meetings. Add the meeting:write:meeting scope to the Zoom app, then reconnect Zoom on the Calendar tab."
          : `Zoom refused: ${String(detail?.message || res.status).slice(0, 200)}`,
      }, 403);
    }
    if (!res.ok) throw new Error(`Zoom create failed: ${(await res.text()).slice(0, 300)}`);

    const m = await res.json();
    return json({ success: true, joinUrl: m.join_url, meetingId: String(m.id || ""), passcode: m.password || "" });
  } catch (err: any) {
    const isAuthErr = err instanceof ZoomAuthError;
    console.error("create-zoom-meeting failed:", err.message);
    return json({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }, isAuthErr ? 401 : 500);
  }
});
