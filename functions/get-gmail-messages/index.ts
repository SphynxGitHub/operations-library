import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get the latest stored access token
    const { data: tokenData, error: dbError } = await supabase
      .from("google_auth_tokens")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (dbError || !tokenData) {
      return new Response(JSON.stringify({ error: "No connected Google account" }), { status: 400 });
    }

    // 2. Fetch Inbox Messages from Gmail API
    const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const gmailData = await gmailRes.json();
    if (!gmailData.messages) {
      return new Response(JSON.stringify({ threads: [] }), { status: 200 });
    }

    // 3. Fetch details for each message
    const threads = await Promise.all(
      gmailData.messages.map(async (msg: any) => {
        const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
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

    return new Response(JSON.stringify({ threads }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
