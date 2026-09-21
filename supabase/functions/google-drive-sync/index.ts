import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";

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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Authorize calling user
    const authz = await authorizeTeamRequest(req, supabase);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error, message: authz.message }), { status: authz.status, headers: corsHeaders });
    }

    // 2. Load refresh token
    const { data: master, error: masterErr } = await supabase
      .from("workspace_masters")
      .select("google_refresh_token")
      .eq("id", "main_state")
      .maybeSingle();

    const refreshToken = master?.google_refresh_token || Deno.env.get("GOOGLE_REFRESH_TOKEN");

    if (!refreshToken) {
      return new Response(JSON.stringify({ 
        error: "missing_refresh_token", 
        message: "No Google refresh token found in workspace_masters or env secrets." 
      }), { status: 400, headers: corsHeaders });
    }

    // 3. Obtain Access Token
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ 
        error: "missing_credentials", 
        message: "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variable is missing." 
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

    if (!tokenRes.ok || !tokenData.access_token) {
      return new Response(JSON.stringify({ 
        error: "token_exchange_failed", 
        details: tokenData,
        message: tokenData.error_description || "Google rejected the refresh token." 
      }), { status: 401, headers: corsHeaders });
    }

    const accessToken = tokenData.access_token;
    const body = await req.json();
    const { action, clientName, clientId: targetClientId } = body;

    if (action === "get_or_create_client_folder") {
      const folderName = (clientName || "Unnamed Client").trim();
      const safeName = folderName.replace(/'/g, "\\'");

      // A. Search for existing root client folder
      const query = `mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`;
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const searchData = await searchRes.json();

      if (!searchRes.ok) {
        return new Response(JSON.stringify({ 
          error: "drive_search_failed", 
          details: searchData,
          message: searchData.error?.message || "Failed to search Google Drive." 
        }), { status: 400, headers: corsHeaders });
      }

      let targetFolderId = searchData.files?.[0]?.id;

      // B. Create root folder if missing
      if (!targetFolderId) {
        const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" })
        });

        const createData = await createRes.json();

        if (!createRes.ok) {
          return new Response(JSON.stringify({ 
            error: "drive_folder_create_failed", 
            details: createData,
            message: createData.error?.message || "Failed to create root client folder on Drive." 
          }), { status: 400, headers: corsHeaders });
        }

        targetFolderId = createData.id;
      }

      // C. Ensure standard subfolders exist
      const subfolders = ["Zoom Recordings", "Task Attachments", "App Snapshots"];
      const subfolderIds: Record<string, string> = {};

      for (const subName of subfolders) {
        const subQuery = `mimeType='application/vnd.google-apps.folder' and name='${subName}' and '${targetFolderId}' in parents and trashed=false`;
        const subSearchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subQuery)}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const subSearchData = await subSearchRes.json();

        if (subSearchData.files?.[0]?.id) {
          subfolderIds[subName] = subSearchData.files[0].id;
        } else {
          const subCreateRes = await fetch("https://www.googleapis.com/drive/v3/files", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: subName, mimeType: "application/vnd.google-apps.folder", parents: [targetFolderId] })
          });
          const subCreateData = await subCreateRes.json();
          subfolderIds[subName] = subCreateData.id;
        }
      }

      // D. Save folder ID directly to workspace_clients DB table if clientId provided
      if (targetClientId) {
        await supabase
          .from("workspace_clients")
          .update({ google_drive_folder_id: targetFolderId })
          .eq("id", targetClientId);
      }

      return new Response(JSON.stringify({ folderId: targetFolderId, subfolders: subfolderIds }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "invalid_action", message: "Action must be get_or_create_client_folder" }), { status: 400, headers: corsHeaders });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: "server_crash", message: err.message }), { status: 500, headers: corsHeaders });
  }
});
