// ================================================================================================
// FUNCTION: google-auth-login
//
// WHAT IT DOES:   Step 1 of Connect Google Account. Checks the caller, then returns
//                 the Google permission-screen address as JSON (it no longer
//                 redirects). The address asks for: read mail, send mail, change mail
//                 (archive, restore, Trash, labels), Google Calendar, and the account
//                 email, and carries a signed state that google-auth-callback checks.
//
// CALLED BY:      The Connect Google Account button in Gmail Settings.
//
// WHO CAN CALL:   A signed-in ADMIN only, because the connection is the company's
//                 single Google account. Everyone else gets 401 or 403.
//
// READS/CHANGES:  Nothing in the database. It only builds the address.
//
// NEEDS:          _shared/auth.ts, _shared/oauth-state.ts. The GOOGLE_CLIENT_ID and
//                 GOOGLE_REDIRECT_URI secrets. Any permission added here only takes
//                 effect after the Google account is reconnected, and must also be
//                 listed on the consent screen in Google Cloud Console.
//
// CHANGED FROM THE ORIGINAL: It used to redirect anyone straight to Google. Now it
//                            needs an admin login and adds the signed state. Also
//                            added the gmail.modify permission.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { signState } from "../_shared/oauth-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

// Step 1 of Connect Google Account. The app calls this with the person's login token and gets back
// the Google address to send the browser to. That address carries a signed "state", which
// google-auth-callback checks before it saves anything. Only an admin can start it, because the
// connection is the company's single Google account.
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
      return new Response(JSON.stringify({ error: "forbidden", message: "Only an admin can connect the company Google account." }), { status: 403, headers: corsHeaders });
    }

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");

    const scopes = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      // Needed to archive, restore and delete (move to Trash) mail, and to add labels. Without it Gmail
      // answers "insufficient authentication scopes" for those. Connecting again is what grants it.
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/userinfo.email"
    ];

    const state = await signState(serviceKey, "google", authz.userId);

    // Scopes MUST be space-separated
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri!)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes.join(" "))}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`;

    return new Response(JSON.stringify({ url: authUrl }), { status: 200, headers: corsHeaders });
  } catch (err: any) {
    console.error("google-auth-login failed:", err.message);
    return new Response(JSON.stringify({ error: "server_error", message: err.message }), { status: 500, headers: corsHeaders });
  }
});
