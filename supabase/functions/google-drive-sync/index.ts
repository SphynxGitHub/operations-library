import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Fetch Google Refresh Token stored from workspace_masters
    const { data: master, error: masterErr } = await supabase
      .from("workspace_masters")
      .select("google_refresh_token, communications")
      .eq("id", "main_state")
      .maybeSingle();

    let refreshToken = master?.google_refresh_token || Deno.env.get("GOOGLE_REFRESH_TOKEN");

    if (!refreshToken) {
      return new Response(JSON.stringify({ 
        error: "missing_refresh_token", 
        message: "No Google refresh token found in database or secrets. Reconnect Google Account in Communications." 
      }), { status: 400, headers: corsHeaders });
    }

    // 2. Exchange refresh token for access token
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ 
        error: "missing_credentials", 
        message: "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing from Supabase Secrets." 
      }), { status: 500, headers: corsHeaders });
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return new Response(JSON.stringify({ 
        error: "token_exchange_failed", 
        details: tokenData,
        message: "Google rejected the refresh token. Please reconnect Google Account in Communications." 
      }), { status: 401, headers: corsHeaders });
    }

    const accessToken = tokenData.access_token;
    const body = await req.json();
    const { action, clientName } = body;

    if (action === "get_or_create_client_folder") {
      const cleanName = (clientName || "Unnamed Client").replace(/'/g, "\\'");
      const q = `mimeType='application/vnd.google-apps.folder' and name='${cleanName}' and trashed=false`;

      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const searchData = await searchRes.json();

      if (searchData.error) {
        return new Response(JSON.stringify({ 
          error: "google_drive_api_error", 
          details: searchData.error,
          message: searchData.error.message || "Google Drive API rejected request." 
        }), { status: 400, headers: corsHeaders });
      }

      let targetFolderId = searchData.files?.[0]?.id;

      // Create root folder if missing
      if (!targetFolderId) {
        const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: clientName, mimeType: "application/vnd.google-apps.folder" })
        });
        const createData = await createRes.json();
        targetFolderId = createData.id;
      }

      // Create subfolders
      const subfolders = ["Zoom Recordings", "Task Attachments", "App Snapshots"];
      const subfolderIds: Record<string, string> = {};

      for (const subName of subfolders) {
        const subQ = `mimeType='application/vnd.google-apps.folder' and name='${subName}' and '${targetFolderId}' in parents and trashed=false`;
        const subSearch = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subQ)}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const subData = await subSearch.json();
        
        if (subData.files?.[0]?.id) {
          subfolderIds[subName] = subData.files[0].id;
        } else {
          const subCreate = await fetch("https://www.googleapis.com/drive/v3/files", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: subName, mimeType: "application/vnd.google-apps.folder", parents: [targetFolderId] })
          });
          const newSubData = await subCreate.json();
          subfolderIds[subName] = newSubData.id;
        }
      }

      return new Response(JSON.stringify({ folderId: targetFolderId, subfolders: subfolderIds }), { 
        status: 200, 
        headers: corsHeaders 
      });
    }

    return new Response(JSON.stringify({ error: "invalid_action" }), { status: 400, headers: corsHeaders });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: "server_crash", message: err.message }), { status: 500, headers: corsHeaders });
  }
});
