// ================================================================================================
// FUNCTION: zoom-auth-login
//
// WHAT IT DOES:   Step 1 of Connect Zoom. Checks the caller, then returns the Zoom
//                 permission-screen address as JSON, carrying a signed state that
//                 zoom-auth-callback checks.
//
// CALLED BY:      The Connect Zoom button in the Calendar tab.
//
// WHO CAN CALL:   A signed-in ADMIN only, because the connection is the company's
//                 single Zoom account. Everyone else gets 401 or 403.
//
// READS/CHANGES:  Nothing in the database. It only builds the address.
//
// NEEDS:          _shared/auth.ts, _shared/oauth-state.ts. The ZOOM_CLIENT_ID and
//                 ZOOM_REDIRECT_URI secrets.
//
// CHANGED FROM THE ORIGINAL: It used to redirect anyone straight to Zoom. Now it needs
//                            an admin login and adds the signed state.
// ================================================================================================

// GET /functions/v1/zoom-auth-login
//
// Step 1 of Connect Zoom. Requires a "General App" (User-managed OAuth
// app) created in the Zoom App Marketplace with these scopes granted:
//   meeting:read:summary   -- AI Companion meeting summaries
//   meeting:read:list_meetings
//   meeting:read:list_past_participants  (optional, not currently used)
//
// Env vars needed (set with `supabase secrets set`):
//   ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_REDIRECT_URI
// ZOOM_REDIRECT_URI must exactly match the Redirect URL configured on the
// Zoom app, and should point at zoom-auth-callback's URL.
//
// The app calls this with the person's login token and gets back the Zoom address to send the
// browser to. That address carries a signed "state", which zoom-auth-callback checks before it saves
// anything. Only an admin can start it, because the connection is the company's single Zoom account.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { signState } from "../_shared/oauth-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const authz = await authorizeTeamRequest(req, supabase);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error, message: authz.message }), { status: authz.status, headers: corsHeaders });
    }
    if (authz.role !== "admin") {
      return new Response(JSON.stringify({ error: "forbidden", message: "Only an admin can connect the company Zoom account." }), { status: 403, headers: corsHeaders });
    }

    const clientId = Deno.env.get("ZOOM_CLIENT_ID");
    const redirectUri = Deno.env.get("ZOOM_REDIRECT_URI");
    const state = await signState(serviceKey, "zoom", authz.userId);

    const authUrl = `https://zoom.us/oauth/authorize?` +
      `response_type=code` +
      `&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri!)}` +
      `&state=${encodeURIComponent(state)}`;

    return new Response(JSON.stringify({ url: authUrl }), { status: 200, headers: corsHeaders });
  } catch (err: any) {
    console.error("zoom-auth-login failed:", err.message);
    return new Response(JSON.stringify({ error: "server_error", message: err.message }), { status: 500, headers: corsHeaders });
  }
});
