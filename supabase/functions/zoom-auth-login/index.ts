// GET /functions/v1/zoom-auth-login
//
// Kicks off Zoom's OAuth flow. Requires a "General App" (User-managed OAuth
// app) created in the Zoom App Marketplace with these scopes granted:
//   meeting:read:summary   -- AI Companion meeting summaries
//   meeting:read:list_meetings
//   meeting:read:list_past_participants  (optional, not currently used)
//
// Env vars needed (set with `supabase secrets set`):
//   ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_REDIRECT_URI
// ZOOM_REDIRECT_URI must exactly match the Redirect URL configured on the
// Zoom app, and should point at zoom-auth-callback's URL.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async () => {
  const clientId = Deno.env.get("ZOOM_CLIENT_ID");
  const redirectUri = Deno.env.get("ZOOM_REDIRECT_URI");

  const authUrl = `https://zoom.us/oauth/authorize?` +
    `response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri!)}`;

  return Response.redirect(authUrl, 302);
});
