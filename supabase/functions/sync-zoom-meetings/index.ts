// ================================================================================================
// FUNCTION: sync-zoom-meetings
//
// WHAT IT DOES:   Pulls Zoom AI Companion meeting summaries for recent calendar events
//                 (last 30 days, up to 25 events), saves each summary on the event and
//                 as a comment, and turns the summary's action items into tasks on the
//                 linked client project. Fuller notes on how it works are below.
//
// CALLED BY:      The Zoom sync in the Calendar tab, the app's 10-minute auto-sync, and
//                 the ol_sync_zoom cron job (see migrations/zoom_autosync.sql).
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member (the app sends the login
//                 token), or a scheduled caller, which sends the service role key or
//                 the CRON_SECRET in an x-cron-secret header. Anyone else gets 401 or
//                 403 and nothing happens.
//
// READS/CHANGES:  Reads Zoom. Updates calendar_events (summary, action items, Drive
//                 status). Exports summary + recording to the client's Drive folder.
//                 Does NOT write project_data (the app creates the tasks).
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

// Zoom has returned action items in a few shapes over time: next_steps as
// strings, next_steps as objects, or only a markdown summary_content with a
// "Next steps" section. All of them are handled; the bullet scan is last.
function extractActionItems(summaryPayload: any): string[] {
  const asText = (s: any) => typeof s === "string" ? s : (s?.text || s?.content || s?.description || s?.title || "");
  const nextSteps = (summaryPayload?.next_steps || []).map(asText).map((t: string) => t.trim()).filter(Boolean);
  if (nextSteps.length > 0) return nextSteps;

  // Some accounts get next steps as a labelled block inside summary_details
  // ("Next steps" / "Action items"), one item per line or sentence.
  const labelled = (summaryPayload?.summary_details || []).find((d: any) => /next steps|action items|follow[- ]?ups?/i.test(String(d?.label || "")));
  if (labelled?.summary) {
    const lines = String(labelled.summary).split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter((l) => l.length > 3);
    const items = lines.length > 1 ? lines : String(labelled.summary).split(/(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim()).filter((x) => x.length > 3);
    if (items.length) return items;
  }

  const md = String(summaryPayload?.summary_content || "");
  if (md) {
    const sec = md.split(/\n(?=#{1,4}\s)/).find((block) => /^#{1,4}\s*(next steps|action items)/i.test(block.trim()));
    if (sec) {
      const items = sec.split("\n").slice(1).map((l) => l.trim().match(/^(?:[-*•]|\d+[.)])\s+(.*)/)?.[1]?.trim()).filter((x): x is string => !!x && x.length > 3);
      if (items.length) return items;
    }
  }

  const text = [
    summaryPayload?.summary_overview || "",
    ...(summaryPayload?.summary_details || []).map((d: any) => d?.summary || "")
  ].join("\n");
  const bulletRe = /^(?:[-*•]|\d+[.)])\s+(.*)/;
  const items: string[] = [];
  for (const line of text.split("\n").map((l: string) => l.trim()).filter(Boolean)) {
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
  if (!parts.length && summaryPayload?.summary_content) parts.push(String(summaryPayload.summary_content).trim());
  const steps = extractActionItems(summaryPayload);
  if (steps.length && !parts.some((p) => /next steps/i.test(p))) parts.push("Next steps:\n" + steps.map((x) => `- ${x}`).join("\n"));
  return parts.join("\n\n").trim();
}

// Calls google-drive-sync as a server caller and REPORTS the result (the
// old helper swallowed every failure, which is how Drive exports failed
// silently for months).
async function callDrive(supabaseUrl: string, serviceKey: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/google-drive-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) console.error(`Drive export "${body.fileName}" failed:`, res.status, data?.message || data?.error);
    return { ok: res.ok && !!data?.success, data };
  } catch (err: any) {
    console.error(`Drive export "${body.fileName}" threw:`, err.message);
    return { ok: false, data: { message: err.message } };
  }
}

const DRIVE_LOOKBACK_DAYS = 14;       // how long we keep retrying Drive exports for a meeting
const RECORDING_GIVE_UP_HOURS = 72;   // no recording by then -> assume none was made
const MAX_DRIVE_EVENTS = 6;           // recordings are big; keep one run short

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
    const reqBody = await req.json().catch(() => ({}));
    const onlyEventId: string | null = reqBody?.eventId ? String(reqBody.eventId) : null;
    // Detailed report for a single-meeting "Re-check Zoom" from the app.
    const report: any = onlyEventId ? { notes: [] } : null;

    // ---------------------------------------------------------------
    // PHASE 0 — find the Zoom meeting for calendar events that don't
    // carry a zoom.us/j/ link (personal meeting room links, Calendly
    // invites, meetings started from Zoom directly). Matches Zoom's own
    // list of recent recordings, summaries and past meetings to the
    // calendar event by start time (within 20 minutes), preferring a
    // similar title. Each list needs its own Zoom permission; any that
    // aren't granted are skipped and named in the report.
    // ---------------------------------------------------------------
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const fromDay = ymd(new Date(Date.now() - LOOKBACK_DAYS * 86400000));
    const toDay = ymd(new Date(Date.now() + 86400000));
    let unmatchedQuery = supabase.from("calendar_events")
      .select("id, title, start, zoom_meeting_id")
      .is("zoom_meeting_id", null)
      .gte("start", windowStart)
      .lte("start", new Date().toISOString())
      .limit(60);
    if (onlyEventId) unmatchedQuery = supabase.from("calendar_events").select("id, title, start, zoom_meeting_id, location, description").eq("id", onlyEventId).limit(1);
    const { data: unmatched } = await unmatchedQuery;
    const needDiscovery = (unmatched || []).filter((e: any) => !e.zoom_meeting_id && !extractZoomMeetingId(e.location) && !extractZoomMeetingId(e.description));

    let discoveredCount = 0;
    if (needDiscovery.length) {
      const zoomList: { id: string; uuid: string; topic: string; start: string; source: string }[] = [];
      const pull = async (url: string, pick: (d: any) => any[], source: string) => {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (r.status === 401) throw new ZoomAuthError("Zoom rejected the token while listing meetings.");
        if (!r.ok) { if (report) report.notes.push(`Zoom ${source} list not available (HTTP ${r.status}${r.status === 400 || r.status === 403 ? ' — the Zoom app may need that permission' : ''}).`); return; }
        const d = await r.json();
        pick(d).forEach((m: any) => m && zoomList.push({ ...m, source }));
      };
      await pull(`https://api.zoom.us/v2/users/me/recordings?from=${fromDay}&to=${toDay}&page_size=300`,
        (d) => (d.meetings || []).map((m: any) => ({ id: String(m.id), uuid: m.uuid, topic: m.topic || "", start: m.start_time })), "recordings");
      await pull(`https://api.zoom.us/v2/meetings/meeting_summaries?from=${fromDay}T00:00:00Z&to=${toDay}T00:00:00Z&page_size=300`,
        (d) => (d.summaries || []).map((m: any) => ({ id: String(m.meeting_id), uuid: m.meeting_uuid, topic: m.meeting_topic || "", start: m.meeting_start_time })), "summaries");
      await pull(`https://api.zoom.us/v2/users/me/meetings?type=previous_meetings&page_size=300`,
        (d) => (d.meetings || []).map((m: any) => ({ id: String(m.id), uuid: m.uuid, topic: m.topic || "", start: m.start_time })), "past meetings");

      const words = (t: string) => new Set(String(t || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
      for (const evt of needDiscovery) {
        const t0 = new Date(evt.start).getTime();
        const ew = words(evt.title);
        let best: any = null, bestScore = -Infinity;
        for (const z of zoomList) {
          if (!z.start || !z.uuid) continue;
          const diffMin = Math.abs(new Date(z.start).getTime() - t0) / 60000;
          if (diffMin > 20) continue;
          const overlap = [...words(z.topic)].filter((w) => ew.has(w)).length;
          const score = overlap * 10 - diffMin;
          if (score > bestScore) { bestScore = score; best = z; }
        }
        if (best) {
          await supabase.from("calendar_events").update({ zoom_meeting_id: best.id, zoom_meeting_uuid: best.uuid }).eq("id", evt.id);
          discoveredCount++;
          if (report) { report.meetingId = best.id; report.matchedBy = `start time via Zoom ${best.source}${best.topic ? `: "${best.topic}"` : ''}`; }
        } else if (report) {
          report.notes.push(`Zoom lists ${zoomList.length} meeting(s) in the last ${LOOKBACK_DAYS} days, none starting within 20 minutes of this event. If someone else hosted it, their Zoom account holds the summary and recording.`);
        }
      }
    }

    // ---------------------------------------------------------------
    // PHASE 1 — summaries. Saves the summary and its action items ON THE
    // EVENT. Tasks are no longer written into project_data from here:
    // that read-modify-write raced the app's own saves (an open app would
    // overwrite the new tasks with its older copy), and it only ever ran
    // if the meeting was already linked to a project at that moment. The
    // app now creates the tasks from zoom_action_items (see
    // OL.materializeZoomActionItems), including for meetings linked later.
    // ---------------------------------------------------------------
    let candQuery = supabase
      .from("calendar_events")
      .select("id, comments, linked_client_id, zoom_meeting_id, zoom_meeting_uuid, location, description, start")
      .eq("zoom_summary_processed", false)
      .or(`zoom_meeting_id.not.is.null,location.ilike.%zoom.us/j/%,description.ilike.%zoom.us/j/%`);
    candQuery = onlyEventId
      ? candQuery.eq("id", onlyEventId)
      : candQuery.gte("start", windowStart).lte("start", new Date().toISOString()).order("start", { ascending: false }).limit(MAX_EVENTS);
    const { data: candidates, error: candidatesErr } = await candQuery;

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
    let actionItemsFound = 0;
    let noSummaryYetCount = 0;
    let otherErrorCount = 0;
    let firstOtherError: any = null;

    for (const evt of zoomEvents) {
      const zoomMeetingId = evt.resolvedMeetingId as string;
      if (report && !report.meetingId) { report.meetingId = zoomMeetingId; report.matchedBy = "link on the invite"; }
      const meetingUuid = evt.zoom_meeting_uuid || await resolvePastMeetingUuid(zoomMeetingId, accessToken, evt.start);
      if (!meetingUuid) {
        noSummaryYetCount++;
        if (report) report.summary = "Zoom has no record of this meeting having happened (no past instance) — it may have been held on another host's account";
        continue;
      }

      const summaryRes = await fetch(`https://api.zoom.us/v2/meetings/${encodeZoomUuid(meetingUuid)}/meeting_summary`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (summaryRes.status === 401) throw new ZoomAuthError("Zoom rejected the token while fetching a meeting summary.");
      if (summaryRes.status === 404) {
        // No summary (yet) — but remember the meeting so the recording
        // pass below can still pick it up.
        await supabase.from("calendar_events").update({ zoom_meeting_id: zoomMeetingId, zoom_meeting_uuid: meetingUuid }).eq("id", evt.id);
        noSummaryYetCount++;
        if (report) report.summary = "none — Zoom has no AI Companion summary for this meeting (summaries must be turned on in the meeting, and only the host's account gets them)";
        continue;
      }
      if (!summaryRes.ok) {
        const detail = await summaryRes.text();
        if (report) report.summary = `Zoom refused (HTTP ${summaryRes.status}): ${detail.slice(0, 160)}`;
        console.error(`Failed to fetch summary for meeting ${zoomMeetingId}:`, detail);
        otherErrorCount++;
        if (!firstOtherError) firstOtherError = { meetingId: zoomMeetingId, meetingUuid, eventId: evt.id, status: summaryRes.status, detail };
        continue;
      }
      const summaryPayload = await summaryRes.json();
      const summaryText = formatSummaryText(summaryPayload);
      const actionItems = extractActionItems(summaryPayload);
      actionItemsFound += actionItems.length;

      // One Zoom summary comment per event, even if this is re-run.
      const existing = evt.comments || [];
      const alreadyCommented = existing.some((c: any) => c?.author === "Zoom" && String(c?.text || "").startsWith("Meeting summary:"));
      const updatedComments = alreadyCommented ? existing : [
        ...existing,
        { id: generateCommentId(), author: "Zoom", text: `Meeting summary:\n\n${summaryText}`, mentions: [], date: new Date().toISOString() }
      ];

      const { error: updateErr } = await supabase
        .from("calendar_events")
        .update({
          zoom_summary: summaryText,
          zoom_meeting_id: zoomMeetingId,
          zoom_meeting_uuid: meetingUuid,
          zoom_action_items: actionItems,
          comments: updatedComments,
          zoom_summary_processed: true
        })
        .eq("id", evt.id);
      if (updateErr) { console.error(`Failed to update calendar event ${evt.id}:`, updateErr.message); continue; }
      summariesPostedCount++;
      if (report) { report.summary = "saved"; report.actionItems = actionItems.length; }
    }

    // Single-meeting re-check: if the meeting wasn't picked up above, say why.
    if (report && !report.meetingId) {
      const { data: row, error: rowErr } = await supabase.from("calendar_events")
        .select("id, zoom_summary_processed, zoom_meeting_id, location, description, start").eq("id", onlyEventId).maybeSingle();
      if (rowErr) report.notes.push(`Couldn't read this meeting: ${rowErr.message}`);
      else if (!row) report.notes.push("This meeting isn't in the calendar table.");
      else {
        const idFromText = extractZoomMeetingId(row.location) || extractZoomMeetingId(row.description);
        if (row.zoom_meeting_id || idFromText) { report.meetingId = row.zoom_meeting_id || idFromText; report.matchedBy = "link on the invite"; }
        if (row.zoom_summary_processed) report.notes.push("The summary step skipped it because it was already marked processed.");
        if (!row.zoom_meeting_id && !idFromText) report.notes.push("No zoom.us/j/ link found in the location or description.");
      }
    }

    // ---------------------------------------------------------------
    // PHASE 2 — Drive exports, retried every run until done. Separate
    // from the summary so a recording that finishes processing hours
    // after the summary, or a meeting linked to a project later, still
    // gets its files.
    // ---------------------------------------------------------------
    const driveStart = new Date(Date.now() - DRIVE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: driveEvents } = await supabase
      .from("calendar_events")
      .select("id, title, start, linked_client_id, zoom_meeting_id, zoom_meeting_uuid, zoom_summary, zoom_summary_in_drive, zoom_recording_status")
      .not("linked_client_id", "is", null)
      .not("zoom_meeting_id", "is", null)
      .gte("start", onlyEventId ? "1970-01-01" : driveStart)
      .filter("id", onlyEventId ? "eq" : "neq", onlyEventId || "__none__")
      .lte("start", new Date().toISOString())
      .or("zoom_summary_in_drive.eq.false,zoom_recording_status.is.null")
      .order("start", { ascending: false })
      .limit(MAX_DRIVE_EVENTS);

    let summariesToDrive = 0, recordingsToDrive = 0, driveErrors = 0;
    const clientNames: Record<string, string> = {};

    for (const evt of driveEvents || []) {
      if (!clientNames[evt.linked_client_id]) {
        const { data: c } = await supabase.from("workspace_clients").select("meta").eq("id", evt.linked_client_id).maybeSingle();
        clientNames[evt.linked_client_id] = c?.meta?.name || "Client Project";
      }
      const clientName = clientNames[evt.linked_client_id];
      const dateStr = String(evt.start || "").slice(0, 10);
      const safeTitle = String(evt.title || "Meeting").replace(/[\\/:*?"<>|]/g, "").slice(0, 80);
      const patch: Record<string, unknown> = {};
      // Optional columns (2026_09c migration) go in a separate update so a
      // missing column can never block the main status update.
      const extraPatch: Record<string, unknown> = {};
      let driveErrorText = "";

      if (!evt.zoom_summary_in_drive && evt.zoom_summary) {
        const r = await callDrive(supabaseUrl, serviceKey, {
          action: "save_text_doc", clientId: evt.linked_client_id, clientName,
          fileName: `${dateStr} ${safeTitle} - Zoom Summary.txt`, content: evt.zoom_summary
        });
        if (r.ok) { patch.zoom_summary_in_drive = true; summariesToDrive++; }
        else { driveErrors++; driveErrorText = `Summary → Drive failed: ${r.data?.message || r.data?.error || 'unknown error'}`; }
      }

      if (!evt.zoom_recording_status) {
        let uuid = evt.zoom_meeting_uuid;
        if (!uuid) uuid = await resolvePastMeetingUuid(evt.zoom_meeting_id, accessToken, evt.start);
        if (uuid) {
          const recRes = await fetch(`https://api.zoom.us/v2/meetings/${encodeZoomUuid(uuid)}/recordings`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const ageHours = (Date.now() - new Date(evt.start).getTime()) / 3600000;
          if (recRes.ok) {
            const recData = await recRes.json();
            const files = recData.recording_files || [];
            const mp4 = files.find((f: any) => f.file_type === "MP4" && f.status === "completed")
              || files.find((f: any) => f.file_type === "MP4");
            if (mp4?.download_url && mp4.status !== "processing") {
              const r = await callDrive(supabaseUrl, serviceKey, {
                action: "upload_zoom_recording", clientId: evt.linked_client_id, clientName,
                fileName: `${dateStr} ${safeTitle} - Zoom Recording.mp4`,
                fileUrl: mp4.download_url, zoomAccessToken: accessToken, fileSize: mp4.file_size, mimeType: "video/mp4"
              });
              if (r.ok) {
                patch.zoom_recording_status = "saved"; recordingsToDrive++;
                if (r.data?.webViewLink) extraPatch.zoom_recording_drive_url = r.data.webViewLink;
                if (report) report.recording = `saved to the client's Drive (Zoom Recordings folder)${r.data?.webViewLink ? ': ' + r.data.webViewLink : ''}`;
              } else {
                driveErrors++;
                driveErrorText = `Recording → Drive failed: ${r.data?.message || r.data?.error || 'unknown error'}`;
                if (report) report.recording = `found, but saving to Drive failed: ${r.data?.message || r.data?.error || 'unknown error'}`;
              }
              if (recData.share_url) {
                // Stored separately so a missing column never blocks the main update.
                extraPatch.zoom_recording_url = recData.share_url;
              }
            } else if (!mp4 && ageHours > RECORDING_GIVE_UP_HOURS) {
              patch.zoom_recording_status = "none";
              if (report) report.recording = "none — the meeting has recording files but no video (MP4)";
            } else if (report) {
              report.recording = mp4 ? "still processing at Zoom — will save automatically once ready" : "no video yet — will keep checking for 72 hours";
            }
          } else if (recRes.status === 404) {
            if (ageHours > RECORDING_GIVE_UP_HOURS) patch.zoom_recording_status = "none"; // no cloud recording was made
            if (report) report.recording = "none — Zoom has no cloud recording for this meeting (local recordings and other hosts' recordings can't be pulled)";
          } else {
            const t = await recRes.text();
            console.error(`Recording lookup refused for ${evt.zoom_meeting_id} (needs cloud_recording:read scope?):`, t);
            driveErrors++;
            driveErrorText = `Zoom refused the recording lookup (HTTP ${recRes.status}) — add the cloud recording read permission to the Zoom app and reconnect`;
            if (report) report.recording = `Zoom refused the lookup (HTTP ${recRes.status}) — the Zoom app likely needs the cloud recording read permission; reconnect Zoom after adding it`;
          }
        } else if (report) {
          report.recording = "couldn't identify the Zoom meeting instance";
        }
      }

      if (Object.keys(patch).length) await supabase.from("calendar_events").update(patch).eq("id", evt.id);
      extraPatch.zoom_drive_error = driveErrorText || null;
      await supabase.from("calendar_events").update(extraPatch).eq("id", evt.id).then(() => {}, () => {});
    }

    return new Response(JSON.stringify({
      scannedEvents: zoomEvents.length,
      summariesPostedCount,
      actionItemsFound,
      tasksCreatedCount: 0, // tasks are created by the app now
      discoveredCount,
      ...(report ? { eventReport: report } : {}),
      version: "2026-09c",
      noSummaryYetCount,
      otherErrorCount,
      firstOtherError,
      summariesToDrive,
      recordingsToDrive,
      driveErrors
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
