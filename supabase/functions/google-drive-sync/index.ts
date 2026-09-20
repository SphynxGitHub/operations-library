import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // 1. Handle CORS Preflight Request Immediately
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, clientName, clientId } = await req.json();

    // Retrieve Google Access Token (ensure system or vault token fallback)
    const accessToken = Deno.env.get("GOOGLE_ACCESS_TOKEN");
    
    if (!accessToken) {
      throw new Error("Missing GOOGLE_ACCESS_TOKEN environment variable in Supabase Secrets.");
    }

    // 2. IDENTIFY OR CREATE CLIENT PROJECT FOLDER
    if (action === "get_or_create_client_folder") {
      const q = `mimeType='application/vnd.google-apps.folder' and name='${clientName}' and trashed=false`;
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const searchData = await searchRes.json();
      let targetFolderId = searchData.files?.[0]?.id;

      // Create root client folder if missing
      if (!targetFolderId) {
        const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: clientName, mimeType: "application/vnd.google-apps.folder" })
        });
        const createData = await createRes.json();
        targetFolderId = createData.id;
      }

      // Create standard subfolders
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
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    // Crucial: Attach corsHeaders to error responses so browser doesn't obscure the error with a CORS message
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
