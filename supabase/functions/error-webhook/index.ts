import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

// Accepts a flexible payload so it works with however you've named fields in
// the Zapier webhook step — snake_case and camelCase variants of each field
// are both recognized. Only "message" is required.
//
// Client matching, tried in this order (first match wins):
//   1. client_id     — the project's actual id in this app (exact, no
//                       guessing). Find it under Project Settings — copy
//                       button next to "OL Project ID".
//   2. client_email   — matched against the project's Team tab email
//                       addresses (same mechanism Gmail/Calendar use).
//   3. sheet_id       — matched against the "Tracking Sheet ID" you set once
//                       under Project Settings > Error Tracking.
//   4. client_name    — fuzzy match against the project name.
// If none match, the error is saved as unassigned rather than guessed.
//
// Example payload (matches the fields in the sample error email):
// {
//   "client_id": "abc123",                  // most reliable — exact project id
//   "client_email": "brent@client.com",     // matched against Team tab emails
//   "client_name": "Brent Hamilton",        // last-resort fuzzy fallback
//   "sheet_id": "1d6BYiMpp1gPkHiKKgUC9usT-_zBfYQgqC27QNUk5Xjk",
//   "title": "Create Wealthbox Note with Content of Voicemail Transcripts",
//   "message": "Trigger partner failure: Cannot read properties of undefined (reading 'uri')",
//   "history_link": "https://zapier.com/app/history?root_id=231798906",
//   "zap_link": "https://zapier.com/editor/231798906",
//   "service": "RingCentral (Custom) (1.0.0)",
//   "root_id": "231798906",
//   "outage": false,
//   "count": 1,
//   "occurred_at": "2026-09-12T19:22:22Z"   // optional, defaults to now
// }
function pick(body: any, ...keys: string[]) {
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== "") return body[k];
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const message = pick(body, "message", "Message");
    if (!message) {
      return new Response(JSON.stringify({ error: "Missing required field: message" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const explicitClientId = pick(body, "client_id", "clientId", "project_id", "projectId");
    const clientEmail = pick(body, "client_email", "clientEmail", "email");
    const sheetId = pick(body, "sheet_id", "sheetId", "Sheet ID");
    const clientName = pick(body, "client_name", "clientName", "client");

    let clientId: string | null = null;

    // 1. Exact project id — no lookup needed, just confirm it's real.
    if (explicitClientId) {
      const { data } = await supabase.from("workspace_clients").select("id").eq("id", explicitClientId).maybeSingle();
      if (data) clientId = data.id;
    }

    // 2. Email against each project's Team tab addresses.
    if (!clientId && clientEmail) {
      const target = String(clientEmail).trim().toLowerCase();
      const { data } = await supabase.from("workspace_clients").select("id, project_data");
      const match = (data || []).find((c: any) =>
        (c.project_data?.teamMembers || []).some((m: any) => (m?.email || "").trim().toLowerCase() === target)
      );
      if (match) clientId = match.id;
    }

    // 3. Legacy tracking-sheet id.
    if (!clientId && sheetId) {
      const { data } = await supabase
        .from("workspace_clients")
        .select("id, meta")
        .eq("meta->>errorSheetId", sheetId)
        .limit(1)
        .maybeSingle();
      if (data) clientId = data.id;
    }

    // 4. Fuzzy name match, last resort.
    if (!clientId && clientName) {
      const { data } = await supabase.from("workspace_clients").select("id, meta");
      const match = (data || []).find((c: any) =>
        (c.meta?.name || "").toLowerCase().includes(String(clientName).toLowerCase()) ||
        String(clientName).toLowerCase().includes((c.meta?.name || "").toLowerCase())
      );
      if (match) clientId = match.id;
    }

    const row = {
      client_id: clientId,
      source: "webhook",
      title: pick(body, "title", "Title"),
      message,
      service: pick(body, "service", "Service"),
      history_link: pick(body, "history_link", "historyLink", "History Link"),
      zap_link: pick(body, "zap_link", "zapLink", "Zap Link"),
      root_id: pick(body, "root_id", "rootId", "Root ID"),
      outage: (() => {
        const v = pick(body, "outage", "Outage");
        if (v === null) return null;
        return v === true || String(v).toLowerCase() === "true";
      })(),
      occurrence_count: (() => {
        const v = pick(body, "count", "occurrence_count", "Count");
        return v !== null ? Number(v) : null;
      })(),
      sheet_id: sheetId,
      occurred_at: pick(body, "occurred_at", "occurredAt") || new Date().toISOString()
    };

    const { data: inserted, error } = await supabase.from("error_log").insert(row).select("id").single();
    if (error) throw new Error(error.message);

    return new Response(JSON.stringify({ success: true, id: inserted.id, matchedClientId: clientId }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    console.error("Error webhook failed:", err.message);
    return new Response(JSON.stringify({ error: "server_error", message: err.message }), { status: 500, headers: corsHeaders });
  }
});
