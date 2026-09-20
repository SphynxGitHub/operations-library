import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken } from "../_shared/google-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const accessToken = await getGoogleAccessToken();
    const { action, clientName, clientId, folderId, fileName, fileBase64, mimeType } = await req.json();

    // 1. IDENTIFY OR CREATE CLIENT PROJECT FOLDER & SUBFOLDERS
    if (action === "get_or_create_client_folder") {
      // Search for existing folder by client name
      const q = `mimeType='application/vnd.google-apps.folder' and name='${clientName}' and trashed=false`;
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const searchData = await searchRes.json();

      let targetFolderId = searchData.files?.[0]?.id;

      // If not found, create root folder
      if (!targetFolderId) {
        const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: clientName, mimeType: "application/vnd.google-apps.folder" })
        });
        const createData = await createRes.json();
        targetFolderId = createData.id;
      }

      // Create standardized subfolders
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
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. UPLOAD FILE DIRECTLY TO A SPECIFIC DRIVE FOLDER
    if (action === "upload_file") {
      const metadata = { name: fileName, parents: [folderId] };
      const blob = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0));

      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("file", new Blob([blob], { type: mimeType }));

      const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form
      });
      const fileData = await uploadRes.json();

      return new Response(JSON.stringify(fileData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
