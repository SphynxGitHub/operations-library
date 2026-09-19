// POST /api/add-zoom-summary-webhook
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
// Auth: shared secret via the `x-webhook-secret` header, checked against
// the ZOOM_SUMMARY_WEBHOOK_SECRET env var.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ZOOM_SUMMARY_WEBHOOK_SECRET   (new — pick any long random string)
//
// Requires the add_zoom_summary_to_calendar_events.sql migration to have
// been run first (adds calendar_events.zoom_summary / zoom_meeting_id).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateCommentId() {
  return 'cmt_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const secret = req.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.ZOOM_SUMMARY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized. Include a valid x-webhook-secret header.' });
  }

  const { eventId, zoomMeetingId, summary, postAsComment = true } = req.body || {};

  if (!summary || typeof summary !== 'string' || !summary.trim()) {
    return res.status(400).json({ error: '`summary` is required and must be a non-empty string.' });
  }
  if (!eventId && !zoomMeetingId) {
    return res.status(400).json({ error: 'Provide either `eventId` or `zoomMeetingId` to identify the event.' });
  }

  // Resolve the target event row. Prefer eventId (exact) when given;
  // fall back to matching on zoomMeetingId (populate that column ahead
  // of time — e.g. when the event is created — for this to work).
  let query = supabase.from('calendar_events').select('id, comments');
  query = eventId ? query.eq('id', eventId) : query.eq('zoom_meeting_id', zoomMeetingId);
  const { data: rows, error: fetchErr } = await query;

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!rows || rows.length === 0) {
    return res.status(404).json({
      error: eventId
        ? 'No calendar event matched that eventId.'
        : 'No calendar event has that zoomMeetingId on file — set calendar_events.zoom_meeting_id ahead of time, or pass eventId instead.'
    });
  }
  if (rows.length > 1) {
    return res.status(409).json({ error: 'zoomMeetingId matched more than one event — use eventId instead.' });
  }

  const evt = rows[0];
  const trimmedSummary = summary.trim();
  const updatePayload = { zoom_summary: trimmedSummary };
  if (zoomMeetingId) updatePayload.zoom_meeting_id = zoomMeetingId;

  if (postAsComment) {
    updatePayload.comments = [
      ...(evt.comments || []),
      {
        id: generateCommentId(),
        author: 'Zoom',
        text: `Meeting summary:\n\n${trimmedSummary}`,
        mentions: [],
        date: new Date().toISOString()
      }
    ];
  }

  const { error: updateErr } = await supabase
    .from('calendar_events')
    .update(updatePayload)
    .eq('id', evt.id);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.status(200).json({ status: 'updated', eventId: evt.id });
}
