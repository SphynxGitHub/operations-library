import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  // CORS Headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json"
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get the latest stored OAuth access token
    const { data: tokenData, error: dbError } = await supabase
      .from("google_auth_tokens")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (dbError || !tokenData) {
      return new Response(JSON.stringify({ error: "No connected Google account found" }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    // 2. Fetch upcoming events from Google Calendar API
    const timeMin = new Date().toISOString();
    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&maxResults=25`;

    const calRes = await fetch(calendarUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const calData = await calRes.json();

    if (calData.error) {
      throw new Error(calData.error.message || "Failed to fetch calendar events");
    }

    // 3. Format events for Quo
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

    return new Response(JSON.stringify({ events }), {
      headers: corsHeaders,
      status: 200
    });

  } catch (err: any) {
    console.error("Calendar Sync Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: corsHeaders,
      status: 500
    });
  }
});
