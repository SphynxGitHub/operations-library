import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

// Refresh Google OAuth token using stored refresh token in workspace_masters / secrets
async function getGoogleAccessToken(supabase: any) {
  const { data: master } = await supabase
    .from("workspace_masters")
    .select("google_refresh_token")
    .eq("id", "main_state")
    .maybeSingle();

  const refreshToken = master?.google_refresh_token || Deno.env.get("GOOGLE_REFRESH_TOKEN");
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("reauth_required");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("reauth_required");
  }
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const authz = await authorizeTeamRequest(req, supabase);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error, message: authz.message }), { status: authz.status, headers: corsHeaders });
    }

    let accessToken: string;
    try {
      accessToken = await getGoogleAccessToken(supabase);
    } catch (err: any) {
      if (err.message === "reauth_required") {
        return new Response(JSON.stringify({ 
          error: "reauth_required", 
          message: "Please click 'Connect Google Account' in Gmail Settings to enable Drive permissions." 
        }), { status: 401, headers: corsHeaders });
      }
      throw err;
    }

    const { action, clientName, clientId } = await req.json();

    if (action === "get_or_create_client_folder") {
      // 1. Search for existing root folder
      const q = `mimeType='application/vnd.google-apps.folder' and name='${clientName.replace(/'/g, "\\'")}' and trashed=false`;
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const searchData = await searchRes.json();
      
      if (searchData.error) {
        if (searchData.error.code === 403 || searchData.error.status === "PERMISSION_DENIED") {
          return new Response(JSON.stringify({ 
            error: "insufficient_scope", 
            message: "Google Drive scope is missing. Please reconnect your Google Account." 
          }), { status: 403, headers: corsHeaders });
        }
        throw new Error(searchData.error.message);
      }

      let targetFolderId = searchData.files?.[0]?.id;

      // 2. Create root folder if missing
      if (!targetFolderId) {
        const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: clientName, mimeType: "application/vnd.google-apps.folder" })
        });
        const createData = await createRes.json();
        targetFolderId = createData.id;
      }

      // 3. Ensure subfolders exist
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

      return new Response(JSON.stringify({ folderId: targetFolderId, subfolders: subfolderIds }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "invalid_action" }), { status: 400, headers: corsHeaders });

  } catch (err: any) {
    console.error("google-drive-sync failed:", err.message);
    return new Response(JSON.stringify({ error: "server_error", message: err.message }), { status: 500, headers: corsHeaders });
  }
});
