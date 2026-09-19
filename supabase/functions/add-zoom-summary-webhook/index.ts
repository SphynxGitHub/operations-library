// POST /functions/v1/add-zoom-summary-webhook
//
// Attaches a Zoom meeting summary (transcript summary, AI Companion
// recap, whatever text you're sending) to a calendar event. Shows up in
// the event modal (see features/business/calendar.js
// OL.openCalendarEventModal) and also gets posted as a comment on that
// event's thread, same as a person typing one in, so it surfaces
// wherever comments already do (mentions, the notifications system, etc).
//
// Zoom's own native webhook payloads vary by event type and plan, so
// this endpoint intentionally does NOT try to parse Zoom's raw shape —
// point Zoom (or a Zapier/Make step sitting between Zoom and here) at
// this URL with the normalized body below instead. That keeps this
// endpoint stable even if Zoom changes their payload format.
//
// Auth: none — deploy with `--no-verify-jwt` so Supabase doesn't require
// its own Authorization header either. Only point trusted systems
// (Zoom/Zapier/Make) at this URL, since anyone with the link can post a
// summary to a calendar event.
//   supabase functions deploy add-zoom-summary-webhook --no-verify-jwt
//
// Requires the add_zoom_summary_to_calendar_events.sql migration to have
// been run first (adds calendar_events.zoom_summary / zoom_meeting_id).
//
// Example payload:
// {
//   "eventId": "primary::abc123",        // preferred — exact calendar_events.id
//   "zoomMeetingId": "123456789",         // fallback — matched against zoom_meeting_id
//   "summary": "Discussed onboarding timeline...",
//   "postAsComment": true                 // optional, defaults to true
// }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

function generateCommentId() {
  return "cmt_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), { status: 405, headers: corsHeaders });
  }

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Body must be valid JSON" }), { status: 400, headers: corsHeaders });
    }

    const { eventId, zoomMeetingId, summary, postAsComment = true } = body || {};

    if (!summary || typeof summary !== "string" || !summary.trim()) {
      return new Response(JSON.stringify({ error: "`summary` is required and must be a non-empty string." }), { status: 400, headers: corsHeaders });
    }
    if (!eventId && !zoomMeetingId) {
      return new Response(JSON.stringify({ error: "Provide either `eventId` or `zoomMeetingId` to identify the event." }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve the target event row. Prefer eventId (exact) when given;
    // fall back to matching on zoomMeetingId (populate that column ahead
    // of time — e.g. when the event is created — for this to work).
    let query = supabase.from("calendar_events").select("id, comments");
    query = eventId ? query.eq("id", eventId) : query.eq("zoom_meeting_id", zoomMeetingId);
    const { data: rows, error: fetchErr } = await query;

    if (fetchErr) return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers: corsHeaders });
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({
        error: eventId
          ? "No calendar event matched that eventId."
          : "No calendar event has that zoomMeetingId on file — set calendar_events.zoom_meeting_id ahead of time, or pass eventId instead."
      }), { status: 404, headers: corsHeaders });
    }
    if (rows.length > 1) {
      return new Response(JSON.stringify({ error: "zoomMeetingId matched more than one event — use eventId instead." }), { status: 409, headers: corsHeaders });
    }

    const evt = rows[0];
    const trimmedSummary = summary.trim();
    const updatePayload: any = { zoom_summary: trimmedSummary };
    if (zoomMeetingId) updatePayload.zoom_meeting_id = zoomMeetingId;

    if (postAsComment) {
      updatePayload.comments = [
        ...(evt.comments || []),
        {
          id: generateCommentId(),
          author: "Zoom",
          text: `Meeting summary:\n\n${trimmedSummary}`,
          mentions: [],
          date: new Date().toISOString()
        }
      ];
    }

    const { error: updateErr } = await supabase
      .from("calendar_events")
      .update(updatePayload)
      .eq("id", evt.id);

    if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: corsHeaders });

    return new Response(JSON.stringify({ status: "updated", eventId: evt.id }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    console.error("add-zoom-summary-webhook failed:", err.message);
    return new Response(JSON.stringify({ error: "server_error", message: err.message }), { status: 500, headers: corsHeaders });
  }
});
