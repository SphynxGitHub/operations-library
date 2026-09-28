// ================================================================================================
// FUNCTION: create-calendar-event
//
// WHAT IT DOES:   Creates a meeting on the connected Google Calendar (title, start, length, guests,
//                 notes, and optionally a Google Meet link). Google emails the invitations. The app then
//                 syncs the calendar so the new meeting shows up like any other, matched to the project
//                 by its guests.
//
// CALLED BY:      The "New meeting" button on the Calendar tab.
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member (the app sends the login token). Anyone else
//                 gets 401 or 403 and nothing happens.
//
// READS/CHANGES:  Google Calendar: adds one event. Nothing in the database.
//
// NEEDS:          _shared/google-token.ts (the stored Google connection), _shared/auth.ts. The Google
//                 connection needs the full calendar permission (it already asks for it).
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authz = await authorizeTeamRequest(req, supabase);
    if (!authz.ok) return json({ error: authz.error, message: authz.message }, authz.status);

    const body = await req.json();
    const title = String(body?.title || "").trim().slice(0, 300);
    const start = String(body?.start || "");            // local date-time, e.g. 2026-10-05T14:00
    const minutes = Math.round(Number(body?.durationMinutes));
    const timeZone = String(body?.timeZone || "America/New_York");
    const calendarId = String(body?.calendarId || "primary");
    const description = String(body?.description || "").slice(0, 8000);
    const addMeet = body?.addMeet === true;
    const attendees = (Array.isArray(body?.attendees) ? body.attendees : [])
      .map((e: unknown) => String(e || "").trim().toLowerCase()).filter((e: string) => EMAIL_RE.test(e)).slice(0, 50);

    if (!title) return json({ error: "bad_request", message: "Give the meeting a title." }, 400);
    if (!LOCAL_DT_RE.test(start)) return json({ error: "bad_request", message: "Pick a start date and time." }, 400);
    if (!(minutes >= 5 && minutes <= 720)) return json({ error: "bad_request", message: "Length must be between 5 minutes and 12 hours." }, 400);
    if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) return json({ error: "bad_request", message: "Unknown time zone." }, 400);
    if (!/^[A-Za-z0-9@._%+-]{1,200}$/.test(calendarId)) return json({ error: "bad_request", message: "Unknown calendar." }, 400);

    // end = start + length, worked out on the clock time itself (Google applies the time zone to both)
    const [d, t] = start.split("T");
    const [y, mo, da] = d.split("-").map(Number);
    const [hh, mm] = t.split(":").map(Number);
    const endUtcLike = new Date(Date.UTC(y, mo - 1, da, hh, mm) + minutes * 60000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const end = `${endUtcLike.getUTCFullYear()}-${pad(endUtcLike.getUTCMonth() + 1)}-${pad(endUtcLike.getUTCDate())}T${pad(endUtcLike.getUTCHours())}:${pad(endUtcLike.getUTCMinutes())}:00`;

    const event: Record<string, unknown> = {
      summary: title,
      description,
      start: { dateTime: start.length === 16 ? `${start}:00` : start, timeZone },
      end: { dateTime: end, timeZone },
      attendees: attendees.map((email: string) => ({ email })),
    };
    if (addMeet) {
      event.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
    }

    const accessToken = await getFreshGoogleAccessToken(supabase);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all${addMeet ? "&conferenceDataVersion=1" : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (res.status === 401) return json({ error: "reauth_required", message: "Google rejected the connection. Please reconnect the account." }, 401);
    if (res.status === 403) return json({ error: "insufficient_scope", message: "Google did not allow creating events. Reconnect Google and accept the calendar permission." }, 403);
    if (!res.ok) throw new Error(`Google Calendar create failed: ${(await res.text()).slice(0, 300)}`);
    const created = await res.json();
    return json({ success: true, eventId: created.id, htmlLink: created.htmlLink, meetLink: created.hangoutLink || null });
  } catch (err: any) {
    const isAuthErr = err instanceof GoogleAuthError;
    console.error("create-calendar-event failed:", err.message);
    return json({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }, isAuthErr ? 401 : 500);
  }
});
