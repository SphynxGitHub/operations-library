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

    // 1. Fetch Inbox Messages from Gmail API
    const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (gmailRes.status === 401) {
      return new Response(
        JSON.stringify({ error: "reauth_required", message: "Google rejected the refreshed token. Please reconnect the account." }),
        { status: 401, headers: corsHeaders }
      );
    }

    const gmailData = await gmailRes.json();
    if (!gmailData.messages) {
      return new Response(JSON.stringify({ threads: [] }), { status: 200, headers: corsHeaders });
    }

    // 2. Fetch details for each message
    const threads = await Promise.all(
      gmailData.messages.map(async (msg: any) => {
        const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const detail = await detailRes.json();

        const headers = detail.payload?.headers || [];
        const subject = headers.find((h: any) => h.name === "Subject")?.value || "No Subject";
        const sender = headers.find((h: any) => h.name === "From")?.value || "Unknown";

        return {
          id: msg.id,
          source: "Gmail",
          sender: sender,
          clientName: "General",
          subject: subject,
          date: "Recent"
        };
      })
    );

    return new Response(JSON.stringify({ threads }), { headers: corsHeaders, status: 200 });

  } catch (err: any) {
    const isAuthErr = err instanceof GoogleAuthError;
    console.error(isAuthErr ? "Gmail Auth Error:" : "Gmail Sync Error:", err.message);
    return new Response(
      JSON.stringify({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }),
      { status: isAuthErr ? 401 : 500, headers: corsHeaders }
    );
  }
});
