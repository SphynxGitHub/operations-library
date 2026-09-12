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

    // Fetch upcoming events from Google Calendar API
    const timeMin = new Date().toISOString();
    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&maxResults=25`;

    const calRes = await fetch(calendarUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (calRes.status === 401) {
      return new Response(
        JSON.stringify({ error: "reauth_required", message: "Google rejected the refreshed token. Please reconnect the account." }),
        { status: 401, headers: corsHeaders }
      );
    }

    const calData = await calRes.json();
    if (calData.error) {
      throw new Error(calData.error.message || "Failed to fetch calendar events");
    }

    // Format events for Quo
    const events = (calData.items || []).map((evt: any) => ({
      id: evt.id,
      title: evt.summary || "Untitled Event",
      description: evt.description || "",
      start: evt.start?.dateTime || evt.start?.date,
      end: evt.end?.dateTime || evt.end?.date,
      location: evt.location || "",
      link: evt.htmlLink,
      source: "Google Calendar"
    }));

    return new Response(JSON.stringify({ events }), { headers: corsHeaders, status: 200 });

  } catch (err: any) {
    const isAuthErr = err instanceof GoogleAuthError;
    console.error(isAuthErr ? "Calendar Auth Error:" : "Calendar Sync Error:", err.message);
    return new Response(
      JSON.stringify({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }),
      { status: isAuthErr ? 401 : 500, headers: corsHeaders }
    );
  }
});
