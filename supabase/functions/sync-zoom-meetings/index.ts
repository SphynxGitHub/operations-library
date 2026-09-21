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

function extractZoomMeetingId(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/zoom\.us\/j\/(\d+)/i);
  return m ? m[1] : null;
}

function encodeZoomUuid(uuid: string): string {
  const needsDoubleEncode = uuid.startsWith("/") || uuid.includes("//");
  const encodedOnce = encodeURIComponent(uuid);
  return needsDoubleEncode ? encodeURIComponent(encodedOnce) : encodedOnce;
}

async function resolvePastMeetingUuid(meetingId: string, accessToken: string, approxStartIso: string | null): Promise<string | null> {
  const res = await fetch(`https://api.zoom.us/v2/past_meetings/${meetingId}/instances`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return null;

  const data = await res.json();
  const instances = data.meetings || [];
  if (instances.length === 0) return null;
  if (instances.length === 1) return instances[0].uuid;

  if (!approxStartIso) return instances[0].uuid;

  const target = new Date(approxStartIso).getTime();
  let best = instances[0];
  let bestDiff = Infinity;
  for (const inst of instances) {
    const diff = Math.abs(new Date(inst.start_time).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = inst; }
  }
  return best.uuid;
}

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

// Helper to push text summaries & MP4 streams to google-drive-sync
async function uploadToGoogleDrive(
  supabaseUrl: string, 
  serviceKey: string, 
  clientId: string, 
  clientName: string, 
  fileName: string, 
  contentOrUrl: string, 
  isUrl: boolean
) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/google-drive-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`
      },
      body: JSON.stringify({
        action: isUrl ? "upload_zoom_recording" : "save_text_doc",
        clientId,
        clientName,
        fileName,
        [isUrl ? "fileUrl" : "content"]: contentOrUrl
      })
    });
  } catch (err: any) {
    console.warn(`Failed to export ${fileName} to Drive:`, err.message);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authz = await authorizeTeamRequest(req, supabase, {
      serviceKey,
      cronSecret: Deno.env.get("CRON_SECRET")
    });
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error, message: authz.message }), { status: authz.status, headers: corsHeaders });
    }

    const accessToken = await getFreshZoomAccessToken(supabase);
    const windowStart = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: candidates, error: candidatesErr } = await supabase
      .from("calendar_events")
      .select("id, comments, linked_client_id, zoom_meeting_id, location, description, start")
      .eq("zoom_summary_processed", false)
      .gte("start", windowStart)
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
      const meetingUuid = await resolvePastMeetingUuid(zoomMeetingId, accessToken, evt.start);
      
      if (!meetingUuid) {
        noSummaryYetCount++;
        continue;
      }

      const summaryRes = await fetch(`https://api.zoom.us/v2/meetings/${encodeZoomUuid(meetingUuid)}/meeting_summary`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (summaryRes.status === 401) throw new ZoomAuthError("Zoom rejected the token while fetching a meeting summary.");
      if (summaryRes.status === 404) {
        noSummaryYetCount++;
        continue;
      }
      if (!summaryRes.ok) {
        const detail = await summaryRes.text();
        console.error(`Failed to fetch summary for meeting ${zoomMeetingId}:`, detail);
        otherErrorCount++;
        if (!firstOtherError) firstOtherError = { meetingId: zoomMeetingId, meetingUuid, eventId: evt.id, status: summaryRes.status, detail };
        continue;
      }
      const summaryPayload = await summaryRes.json();

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
          zoom_meeting_id: zoomMeetingId,
          comments: updatedComments,
          zoom_summary_processed: true
        })
        .eq("id", evt.id);

      if (updateErr) {
        console.error(`Failed to update calendar event ${evt.id}:`, updateErr.message);
        continue;
      }
      summariesPostedCount++;

      // Create linked tasks from action items
      if (evt.linked_client_id) {
        const { data: clientRow } = await supabase
          .from("workspace_clients")
          .select("project_data, meta")
          .eq("id", evt.linked_client_id)
          .maybeSingle();

        if (clientRow) {
          const clientName = clientRow.meta?.name || "Client Project";
          const dateStr = new Date(evt.start).toISOString().split("T")[0];

          // 1. Create Tasks in project_data
          if (actionItems.length > 0) {
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

            await supabase
              .from("workspace_clients")
              .update({ project_data: projectData })
              .eq("id", evt.linked_client_id);
          }

          // 2. Export Summary Document to Client Drive Subfolder
          await uploadToGoogleDrive(
            supabaseUrl,
            serviceKey,
            evt.linked_client_id,
            clientName,
            `Zoom Summary - ${dateStr}.txt`,
            summaryText,
            false
          );

          // 3. Export Video Recording to Client Drive Subfolder (If available)
          const recRes = await fetch(`https://api.zoom.us/v2/meetings/${encodeZoomUuid(meetingUuid)}/recordings`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });

          if (recRes.ok) {
            const recData = await recRes.json();
            const mp4File = (recData.recording_files || []).find((f: any) => f.file_type === "MP4");

            if (mp4File?.download_url) {
              await uploadToGoogleDrive(
                supabaseUrl,
                serviceKey,
                evt.linked_client_id,
                clientName,
                `Zoom Recording - ${dateStr}.mp4`,
                `${mp4File.download_url}?access_token=${accessToken}`,
                true
              );
            }
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
