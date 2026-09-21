import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return new Response(`Google returned OAuth error: ${errorParam}`, { status: 400 });
  }

  if (!code) {
    return new Response("Missing code parameter from Google.", { status: 400 });
  }

  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI")!;
    const appUrl = Deno.env.get("APP_URL") || "https://sphynx.github.io/operations-library";

    // 1. Exchange OAuth code for Access & Refresh Tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || (!tokenData.access_token && !tokenData.refresh_token)) {
      return new Response(`Token Exchange Failed!\nStatus: ${tokenRes.status}\nPayload: ${JSON.stringify(tokenData, null, 2)}`, {
        status: 400,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // 2. Get User Email
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();

    // 3. Save directly to workspace_masters
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const updatePayload: Record<string, any> = {
      google_connected: true,
      google_account_email: userData.email || "connected@google.com",
    };

    if (tokenData.refresh_token) {
      updatePayload.google_refresh_token = tokenData.refresh_token;
    }

    const { data: dbData, error: dbErr } = await supabase
      .from("workspace_masters")
      .update(updatePayload)
      .eq("id", "main_state")
      .select();

    if (dbErr) {
      return new Response(`Database Update Failed!\nError: ${JSON.stringify(dbErr, null, 2)}`, {
        status: 500,
        headers: { "Content-Type": "text/plain" }
      });
    }

    if (!tokenData.refresh_token) {
      // If Google didn't return a refresh_token, show warning instead of hiding it
      return new Response(`Google did NOT send a refresh_token in the payload!\nReceived Payload:\n${JSON.stringify(tokenData, null, 2)}\nDB Row Updated: ${JSON.stringify(dbData, null, 2)}`, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // 4. Success -> Redirect back to app
    const targetUrl = `${appUrl.replace(/\/$/, '')}/#/business/communications?connected=true`;
    return Response.redirect(targetUrl, 302);

  } catch (err: any) {
    return new Response(`Callback Crash: ${err.message}`, { status: 500, headers: { "Content-Type": "text/plain" } });
  }
});
