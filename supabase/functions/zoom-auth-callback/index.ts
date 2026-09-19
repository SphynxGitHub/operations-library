import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

  const clientId = Deno.env.get("ZOOM_CLIENT_ID")!;
  const clientSecret = Deno.env.get("ZOOM_CLIENT_SECRET")!;
  const redirectUri = Deno.env.get("ZOOM_REDIRECT_URI")!;
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  try {
    // 1. Exchange authorization code for tokens
    const tokenResponse = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      throw new Error(tokens.reason || tokens.error);
    }

    // 2. Fetch the connected user's email (identifies which row to upsert)
    const userResponse = await fetch("https://api.zoom.us/v2/users/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userData = await userResponse.json();

    if (!userResponse.ok || !userData.email) {
      // Most likely cause: the Zoom app doesn't have the user-profile scope
      // granted (needs "user:read:user" -- sometimes just shown as "View"
      // under the User category in the Marketplace app's Scopes tab), so
      // this call came back as an error object instead of user info.
      console.error("Zoom /v2/users/me did not return an email:", JSON.stringify(userData));
      throw new Error(
        `Zoom didn't return a user email (got: ${userData.message || userData.reason || JSON.stringify(userData)}). ` +
        `Check that the Zoom app has the "user:read:user" scope granted, then reconnect.`
      );
    }

    // 3. Store tokens
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: dbError } = await supabase.from("zoom_auth_tokens").upsert({
      email: userData.email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'email' });

    if (dbError) throw dbError;

    // 4. Redirect back to the calendar page
    const returnUrl = "https://sphynxgithub.github.io/operations-library/?admin=pizza123#/business/calendar?zoom_connected=true";
    return Response.redirect(returnUrl, 302);

  } catch (err) {
    console.error("Zoom OAuth Error:", err);
    return new Response(`Zoom authentication failed: ${err.message}`, { status: 500 });
  }
});
