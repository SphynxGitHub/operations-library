// ================================================================================================
// FUNCTION: sync-zoom-meetings
//
// WHAT IT DOES:   Pulls Zoom AI Companion meeting summaries for recent calendar events
//                 (last 30 days, up to 25 events), saves each summary on the event and
//                 as a comment, and turns the summary's action items into tasks on the
//                 linked client project. Fuller notes on how it works are below.
//
// CALLED BY:      The Zoom sync in the Calendar tab. Nothing schedules it.
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member (the app sends the login
//                 token), or a scheduled caller, which sends the service role key or
//                 the CRON_SECRET in an x-cron-secret header. Anyone else gets 401 or
//                 403 and nothing happens. (No job uses the scheduled option today.)
//
// READS/CHANGES:  Reads Zoom. Updates calendar_events (zoom_summary, comments).
//                 Rewrites the client's whole project_data to add the new tasks.
//
// NEEDS:          _shared/zoom-token.ts (the stored Zoom connection), _shared/auth.ts.
//                 Needs Zoom's meeting:read:summary permission.
//
// CHANGED FROM THE ORIGINAL: Added the login check, and acceptance of the scheduled
//                            callers' key or secret. Nothing else.
// ================================================================================================

// POST /functions/v1/sync-zoom-meetings
//
// Replaces the old add-zoom-summary-webhook flow. Instead of an external
// system (Zapier/Make/Zoom itself) pushing a summary to a URL you have to
// look up an eventId for, this pulls meeting summaries straight from
// Zoom's API and attaches them to the matching calendar event itself:
//
//   1. Find calendar_events that look like Zoom meetings (either already
//      have a zoom_meeting_id, or have a Zoom join link in their location
//      or description) and haven't been processed yet.
//   2. For each, fetch its AI Companion meeting summary, if Zoom has
//      generated one yet (they can take a while after the call ends).
//   3. Save the summary onto the event (zoom_summary) and post it as a
//      comment on the event's thread, same as before.
//   4. Parse action items out of the summary (Zoom's own "next_steps" list
//      when present, else a heuristic scan of the summary text for
//      bullet/numbered lines) and create them as tasks linked to whichever
//      client project the calendar event itself is linked to.
//
// This deliberately does NOT use Zoom's Report/Dashboard API (the
// `/report/users/.../meetings` endpoint an earlier draft of this used) --
// that requires the report:read:user:admin scope, which needs an
// admin-level app and isn't available on every plan. Starting from your
// own already-synced calendar events instead means the only Zoom scope
// needed is meeting:read:summary.
//
// Requires: the zoom_direct_sync.sql migration, a connected Zoom account
// (see zoom-auth-login), and ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET env vars.
// Meeting summaries require Zoom's AI Companion to be enabled on the
// account and the meeting:read:summary scope granted on the OAuth app.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { getFreshZoomAccessToken, ZoomAuthError } from "../_shared/zoom-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

const LOOKBACK_DAYS = 30;
const MAX_EVENTS = 25;

function generateCommentId() {
  return "cmt_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function generateTaskId() {
  return "task_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Pulls a Zoom meeting id out of a join URL like
// https://us02web.zoom.us/j/1234567890?pwd=... -- this is how Google
// Calendar events created via the Zoom add-on carry the meeting id, in
// either the event's location or its description.
function extractZoomMeetingId(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/zoom\.us\/j\/(\d+)/i);
  return m ? m[1] : null;
}

// Zoom requires the UUID to be double-URL-encoded when used as a path
// segment, but ONLY when it starts with "/" or contains "//" (their docs
// call this out explicitly) -- for an ordinary UUID like
// "ORqZo6HLQHqkNQw7EtDDIQ==", a normal single encodeURIComponent is
// correct, and double-encoding it instead turns the %3D's into %253D's,
// which Zoom no longer recognizes as the same meeting (looks like a
// generic failure, not an obviously-wrong-uuid error).
function encodeZoomUuid(uuid: string): string {
  const needsDoubleEncode = uuid.startsWith("/") || uuid.includes("//");
  const encodedOnce = encodeURIComponent(uuid);
  return needsDoubleEncode ? encodeURIComponent(encodedOnce) : encodedOnce;
}

// A numeric Zoom meeting id stops being usable for per-meeting lookups
// (meeting_summary included) once the meeting has ended -- Zoom returns
// {"code":300,"message":"Invalid meeting id."} for it. The fix is to
// resolve it to that specific occurrence's UUID first via the past-meeting
// instances list, then use the UUID everywhere instead. For a recurring or
// personal meeting ID reused across many calls, this list can have several
// entries, so pick whichever instance's start_time is closest to the
// calendar event's own start time.
async function resolvePastMeetingUuid(meetingId: string, accessToken: string, approxStartIso: string | null): Promise<string | null> {
  const res = await fetch(`https://api.zoom.us/v2/past_meetings/${meetingId}/instances`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return null;

  const data = await res.json();
  const instances = data.meetings || [];
  if (instances.length === 0) return null;
  if (instances.length === 1) return instances[0].uuid;

  if (!approxStartIso) return instances[0].uuid; // best guess without a time to compare against

  const target = new Date(approxStartIso).getTime();
  let best = instances[0];
  let bestDiff = Infinity;
  for (const inst of instances) {
    const diff = Math.abs(new Date(inst.start_time).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = inst; }
  }
  return best.uuid;
}

// Zoom's meeting_summary response includes a "next_steps" array when its AI
// picks out clear action items on its own. When that's empty/absent (short
// calls, or AI Companion not confident enough), fall back to scanning the
// summary text for lines that look like bullets/numbered items -- good
// enough to be useful, not meant to be perfect.
function extractActionItems(summaryPayload: any): string[] {
  const nextSteps = (summaryPayload?.next_steps || []).filter((s: any) => typeof s === "string" && s.trim());
  if (nextSteps.length > 0) return nextSteps.map((s: string) => s.trim());

  const text = [
    summaryPayload?.summary_overview || "",
    ...(summaryPayload?.summary_details || []).map((d: any) => d?.summary || "")
  ].join("\n");

  const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
  const bulletRe = /^(?:[-*•]|\d+[.)])\s+(.*)/;
  const items: string[] = [];
  for (const line of lines) {
    const m = line.match(bulletRe);
    if (m && m[1].length > 3) items.push(m[1].trim());
  }
  return items;
}

function formatSummaryText(summaryPayload: any): string {
  const parts: string[] = [];
  if (summaryPayload?.summary_overview) parts.push(summaryPayload.summary_overview.trim());
  for (const d of summaryPayload?.summary_details || []) {
    if (d?.label && d?.summary) parts.push(`${d.label}:\n${d.summary}`);
  }
  return parts.join("\n\n").trim();
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

    const accessToken = await getFreshZoomAccessToken(supabase);

    // 1. Find candidate calendar events: not yet processed, within the
    // lookback window, and either already know their Zoom meeting id or
    // have a Zoom join link we can pull one from.
    const windowStart = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: candidates, error: candidatesErr } = await supabase
      .from("calendar_events")
      .select("id, comments, linked_client_id, zoom_meeting_id, location, description, start")
      .eq("zoom_summary_processed", false)
      .gte("start", windowStart)
      // Filter to Zoom-looking events in the query itself, not after
      // fetching a fixed-size page of ALL recent events -- a busy calendar
      // easily has 200+ non-Zoom events in 30 days, which could push the
      // actual Zoom meeting off the end before the JS-side filter below
      // ever saw it.
      .or(`zoom_meeting_id.not.is.null,location.ilike.%zoom.us/j/%,description.ilike.%zoom.us/j/%`)
      .order("start", { ascending: false })
      .limit(MAX_EVENTS);

    if (candidatesErr) {
      return new Response(JSON.stringify({ error: "db_error", message: candidatesErr.message }), { status: 500, headers: corsHeaders });
    }

    const zoomEvents = (candidates || [])
      .map(evt => ({
        ...evt,
        resolvedMeetingId: evt.zoom_meeting_id || extractZoomMeetingId(evt.location) || extractZoomMeetingId(evt.description)
      }))
      .filter(evt => evt.resolvedMeetingId);

    let summariesPostedCount = 0;
    let tasksCreatedCount = 0;
    let noSummaryYetCount = 0;
    let otherErrorCount = 0;
    let firstOtherError: any = null;

    for (const evt of zoomEvents) {
      const zoomMeetingId = evt.resolvedMeetingId as string;

      // 1b. Resolve to this specific occurrence's UUID -- see comment on
      // resolvePastMeetingUuid above for why the numeric id alone doesn't
      // work here.
      const meetingUuid = await resolvePastMeetingUuid(zoomMeetingId, accessToken, evt.start);
      if (!meetingUuid) {
        // Couldn't find a past-instance record at all -- treat like "no
        // summary yet" rather than a hard error, since this is the normal
        // state for a meeting that's scheduled but hasn't happened, or
        // happened too recently for Zoom to have indexed it as a past
        // meeting instance yet.
        noSummaryYetCount++;
        continue;
      }

      // 2. Fetch the AI Companion summary for this meeting, if Zoom has one.
      const summaryRes = await fetch(`https://api.zoom.us/v2/meetings/${encodeZoomUuid(meetingUuid)}/meeting_summary`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (summaryRes.status === 401) throw new ZoomAuthError("Zoom rejected the token while fetching a meeting summary.");
      if (summaryRes.status === 404) {
        // No summary yet (still generating, or AI Companion wasn't used for this call).
        noSummaryYetCount++;
        continue;
      }
      if (!summaryRes.ok) {
        const detail = await summaryRes.text();
        console.error(`Failed to fetch summary for meeting ${zoomMeetingId} (uuid ${meetingUuid}, event ${evt.id}):`, detail);
        otherErrorCount++;
        if (!firstOtherError) firstOtherError = { meetingId: zoomMeetingId, meetingUuid, eventId: evt.id, status: summaryRes.status, detail };
        continue;
      }
      const summaryPayload = await summaryRes.json();

      // 3. Save summary + post as a comment.
      const summaryText = formatSummaryText(summaryPayload);
      const actionItems = extractActionItems(summaryPayload);

      const updatedComments = [
        ...(evt.comments || []),
        {
          id: generateCommentId(),
          author: "Zoom",
          text: `Meeting summary:\n\n${summaryText}`,
          mentions: [],
          date: new Date().toISOString()
        }
      ];

      const { error: updateErr } = await supabase
        .from("calendar_events")
        .update({
          zoom_summary: summaryText,
          zoom_meeting_id: zoomMeetingId, // backfilled if this event didn't have it stored yet
          comments: updatedComments,
          zoom_summary_processed: true
        })
        .eq("id", evt.id);

      if (updateErr) {
        console.error(`Failed to update calendar event ${evt.id}:`, updateErr.message);
        continue;
      }
      summariesPostedCount++;

      // 4. Create linked tasks from action items, if this event is tied to a project.
      if (evt.linked_client_id && actionItems.length > 0) {
        const { data: clientRow, error: clientErr } = await supabase
          .from("workspace_clients")
          .select("project_data")
          .eq("id", evt.linked_client_id)
          .maybeSingle();

        if (!clientErr && clientRow) {
          const projectData = clientRow.project_data || {};
          if (!projectData.clientTasks) projectData.clientTasks = [];

          for (const item of actionItems) {
            projectData.clientTasks.unshift({
              id: generateTaskId(),
              title: item,
              name: item,
              status: "Pending Sphynx Action",
              assignee: "Sphynx Task",
              dueDate: "",
              isClientTask: false,
              loggedHours: 0,
              createdAt: new Date().toISOString(),
              linkedEventId: evt.id,
              source: "zoom_summary"
            });
            tasksCreatedCount++;
          }

          const { error: taskWriteErr } = await supabase
            .from("workspace_clients")
            .update({ project_data: projectData })
            .eq("id", evt.linked_client_id);

          if (taskWriteErr) {
            console.error(`Failed to write action-item tasks for client ${evt.linked_client_id}:`, taskWriteErr.message);
          }
        }
      }
    }

    return new Response(JSON.stringify({
      scannedEvents: zoomEvents.length,
      summariesPostedCount,
      tasksCreatedCount,
      noSummaryYetCount,
      otherErrorCount,
      firstOtherError
    }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    const isAuthErr = err instanceof ZoomAuthError;
    console.error(isAuthErr ? "Zoom Auth Error:" : "Zoom Sync Error:", err.message);
    return new Response(
      JSON.stringify({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }),
      { status: isAuthErr ? 401 : 500, headers: corsHeaders }
    );
  }
});
