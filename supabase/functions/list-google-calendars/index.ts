import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const accessToken = await getFreshGoogleAccessToken(supabase);

    // showHidden=true matters here: Google excludes any calendar you've
    // unchecked/hidden in the Calendar UI by default, which is exactly the
    // kind of calendar that tends to live under "Other calendars" — without
    // this you'd only ever see a subset of what's actually in your account.
    const calendars: any[] = [];
    let pageToken: string | undefined;
    let page = 0;

    do {
      const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
      url.searchParams.set("showHidden", "true");
      url.searchParams.set("maxResults", "250");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });

      if (res.status === 401) {
        return new Response(
          JSON.stringify({ error: "reauth_required", message: "Google rejected the refreshed token. Please reconnect the account." }),
          { status: 401, headers: corsHeaders }
        );
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Failed to list calendars");

      (data.items || []).forEach((c: any) => {
        calendars.push({
          id: c.id,
          summary: c.summaryOverride || c.summary || c.id,
          primary: !!c.primary,
          accessRole: c.accessRole || "reader",
          backgroundColor: c.backgroundColor || null
        });
      });

      pageToken = data.nextPageToken;
      page++;
    } while (pageToken && page < 5);

    return new Response(JSON.stringify({ calendars }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    const isAuthErr = err instanceof GoogleAuthError;
    console.error(isAuthErr ? "List Calendars Auth Error:" : "List Calendars Error:", err.message);
    return new Response(
      JSON.stringify({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }),
      { status: isAuthErr ? 401 : 500, headers: corsHeaders }
    );
  }
});
