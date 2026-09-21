import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response("Missing code parameter", { status: 400 });
  }

  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI")!;

    // 1. Exchange code for Google Access & Refresh Tokens
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

    if (!tokenData.refresh_token && !tokenData.access_token) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
    }

    // 2. Fetch Google User Email
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();

    // 3. Save Refresh Token into workspace_masters in Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const updatePayload: Record<string, any> = {
      google_connected: true,
      google_account_email: userData.email,
    };

    // Only overwrite refresh_token if Google sent a new one
    if (tokenData.refresh_token) {
      updatePayload.google_refresh_token = tokenData.refresh_token;
    }

    await supabase
      .from("workspace_masters")
      .update(updatePayload)
      .eq("id", "main_state");

    // 4. Redirect back to the web app
    return Response.redirect(`${redirectUri.split("#")[0]}#/business/communications?connected=true`, 302);

  } catch (err: any) {
    console.error("google-auth-callback failed:", err.message);
    return new Response(`Authentication error: ${err.message}`, { status: 500 });
  }
});
