import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { getFreshGoogleAccessToken } from "../_shared/google-token.ts";

// Every Drive call goes through here so Shared Drives work: without
// supportsAllDrives (and includeItemsFromAllDrives on searches) Google
// answers "not found" for any folder that lives in a Shared Drive — which
// is where client folders are moving.
function driveFetch(url: string, init?: RequestInit) {
  const u = new URL(url);
  u.searchParams.set("supportsAllDrives", "true");
  if (u.searchParams.has("q")) {
    u.searchParams.set("includeItemsFromAllDrives", "true");
    u.searchParams.set("corpora", "allDrives");
  }
  return fetch(u.toString(), init);
}

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

    // 1. Authorize the caller: a signed-in admin/team member, OR a server-side
    // caller (sync-zoom-meetings passes the service role key). Without the
    // serviceKey option every Zoom summary/recording export was refused with
    // 401 — and sync-zoom-meetings swallowed that, so nothing reached Drive.
    const authz = await authorizeTeamRequest(req, supabase, {
      serviceKey,
      cronSecret: Deno.env.get("CRON_SECRET")
    });
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error, message: authz.message }), { status: authz.status, headers: corsHeaders });
    }

    // 2. Google access. Use the SAME connected account the Gmail/Calendar
    // syncs use (google_auth_tokens, refreshed automatically). The old code
    // only looked at a legacy workspace_masters.google_refresh_token, which
    // is empty or stale on most setups — so Drive exports failed even after
    // the auth fix. The legacy token is still used as a fallback.
    let accessToken = "";
    try { accessToken = await getFreshGoogleAccessToken(supabase); } catch (_e) { accessToken = ""; }

    const { data: master, error: masterErr } = accessToken ? { data: null, error: null } : await supabase
      .from("workspace_masters")
      .select("google_refresh_token")
      .eq("id", "main_state")
      .maybeSingle();

    const refreshToken = master?.google_refresh_token || Deno.env.get("GOOGLE_REFRESH_TOKEN");

    if (!accessToken && !refreshToken) {
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

    if (!accessToken) {
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

    accessToken = tokenData.access_token;
    }
    const body = await req.json();
    const { action, clientName, clientId: targetClientId } = body;

    // =========================================================================
    // ACTION 1 & 2: Save Summary Text Doc or Upload Zoom Video Stream
    // =========================================================================
    if (action === "save_text_doc" || action === "upload_zoom_recording") {
      const { clientId, clientName, fileName, content, fileUrl, zoomAccessToken, fileSize, mimeType } = body;

      // Resolve client Drive folder ID from database
      const { data: client } = await supabase
        .from("workspace_clients")
        .select("google_drive_folder_id")
        .eq("id", clientId)
        .maybeSingle();

      let targetFolderId = client?.google_drive_folder_id;

      // The stored folder must actually be reachable by the connected
      // account. If it isn't (moved to a Shared Drive the account can't
      // see, deleted, or made outside the app with drive.file access),
      // say so instead of quietly dropping files somewhere else.
      if (targetFolderId) {
        const chk = await driveFetch(`https://www.googleapis.com/drive/v3/files/${targetFolderId}?fields=id,name,trashed`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!chk.ok) {
          const detail = await chk.text();
          return new Response(JSON.stringify({
            error: "client_folder_not_accessible",
            message: `This client's Drive folder (${targetFolderId}) can't be opened by the connected Google account (HTTP ${chk.status}). Share it (or its Shared Drive) with that account, or reconnect Google with full Drive access.`,
            detail: detail.slice(0, 300)
          }), { status: 502, headers: corsHeaders });
        }
      }

      // Create root folder if missing
      if (!targetFolderId) {
        const rootName = (clientName || "Unnamed Client").trim();
        const createRes = await driveFetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: rootName, mimeType: "application/vnd.google-apps.folder" })
        });
        const createData = await createRes.json();
        targetFolderId = createData.id;

        if (clientId && targetFolderId) {
          await supabase.from("workspace_clients").update({ google_drive_folder_id: targetFolderId }).eq("id", clientId);
        }
      }

      // Resolve "Zoom Recordings" subfolder
      const subQ = `mimeType='application/vnd.google-apps.folder' and name='Zoom Recordings' and '${targetFolderId}' in parents and trashed=false`;
      const subSearch = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subQ)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const subData = await subSearch.json();
      let zoomFolderId = subData.files?.[0]?.id;

      if (!zoomFolderId) {
        const subCreate = await driveFetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Zoom Recordings", mimeType: "application/vnd.google-apps.folder", parents: [targetFolderId] })
        });
        const subCreateData = await subCreate.json();
        zoomFolderId = subCreateData.id;
      }

      const metadata = { name: fileName, parents: [zoomFolderId] };

      // Don't upload the same file twice (a retry after a partial failure).
      const dupQ = `name='${String(fileName).replace(/'/g, "\\'")}' and '${zoomFolderId}' in parents and trashed=false`;
      const dupRes = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(dupQ)}&fields=files(id,webViewLink)`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const dupData = await dupRes.json().catch(() => ({}));
      if (dupData.files?.[0]?.id) {
        return new Response(JSON.stringify({ success: true, fileId: dupData.files[0].id, webViewLink: dupData.files[0].webViewLink, alreadyThere: true }), { status: 200, headers: corsHeaders });
      }

      if (action === "save_text_doc") {
        const formData = new FormData();
        formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        formData.append("file", new Blob([content || ""], { type: "text/plain" }));
        const uploadRes = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok || !uploadData.id) {
          return new Response(JSON.stringify({ error: "drive_upload_failed", message: uploadData?.error?.message || `HTTP ${uploadRes.status}` }), { status: 502, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ success: true, fileId: uploadData.id, webViewLink: uploadData.webViewLink }), { status: 200, headers: corsHeaders });
      }

      // ---- Zoom recording: streamed, chunked resumable upload ----
      // Zoom now requires the token in an Authorization header (the old
      // ?access_token= query string is deprecated), and a recording can be
      // hundreds of MB, so it's never held in memory: it's read from Zoom's
      // stream and sent to Drive in 8 MB pieces.
      if (!fileUrl) {
        return new Response(JSON.stringify({ error: "missing_file_url" }), { status: 400, headers: corsHeaders });
      }
      const zoomRes = await fetch(fileUrl, {
        headers: zoomAccessToken ? { Authorization: `Bearer ${zoomAccessToken}` } : {},
        redirect: "follow"
      });
      if (!zoomRes.ok || !zoomRes.body) {
        return new Response(JSON.stringify({ error: "zoom_download_failed", message: `Zoom answered HTTP ${zoomRes.status}` }), { status: 502, headers: corsHeaders });
      }
      const totalSize = Number(fileSize) || Number(zoomRes.headers.get("content-length")) || 0;
      const contentType = mimeType || zoomRes.headers.get("content-type") || "video/mp4";

      const sessionRes = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": contentType,
          ...(totalSize ? { "X-Upload-Content-Length": String(totalSize) } : {})
        },
        body: JSON.stringify(metadata)
      });
      const sessionUrl = sessionRes.headers.get("location");
      if (!sessionRes.ok || !sessionUrl) {
        const t = await sessionRes.text();
        return new Response(JSON.stringify({ error: "drive_session_failed", message: t.slice(0, 500) }), { status: 502, headers: corsHeaders });
      }

      const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KB
      const reader = zoomRes.body.getReader();
      let buffer = new Uint8Array(0);
      let offset = 0;
      let finalData: any = null;
      let done = false;

      const sendChunk = async (chunk: Uint8Array, isLast: boolean) => {
        const end = offset + chunk.length - 1;
        const total = isLast ? String(offset + chunk.length) : "*";
        const range = chunk.length ? `bytes ${offset}-${end}/${total}` : `bytes */${total}`;
        const r = await fetch(sessionUrl, { method: "PUT", headers: { "Content-Range": range }, body: chunk });
        if (r.status === 308) { offset += chunk.length; return; }
        if (r.ok) { finalData = await r.json().catch(() => ({})); offset += chunk.length; return; }
        throw new Error(`Drive chunk upload failed (HTTP ${r.status}): ${(await r.text()).slice(0, 300)}`);
      };

      try {
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (value) {
            const merged = new Uint8Array(buffer.length + value.length);
            merged.set(buffer); merged.set(value, buffer.length);
            buffer = merged;
          }
          done = streamDone;
          while (buffer.length >= CHUNK && !(done && buffer.length === CHUNK)) {
            await sendChunk(buffer.slice(0, CHUNK), false);
            buffer = buffer.slice(CHUNK);
          }
        }
        await sendChunk(buffer, true);
      } catch (e: any) {
        return new Response(JSON.stringify({ error: "drive_upload_failed", message: e.message }), { status: 502, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ success: true, fileId: finalData?.id, webViewLink: finalData?.webViewLink, bytes: offset }), { status: 200, headers: corsHeaders });
    }
    // ACTION 2B: SYNC UPLOADS

    // Inside google-drive-sync index.ts serve handler...
    if (action === "upload_client_file") {
      const { clientId, clientName, fileName, fileData, fileType, subfolderName } = body;

      // 1. Resolve client Drive folder ID from database
      const { data: client } = await supabase
        .from("workspace_clients")
        .select("google_drive_folder_id")
        .eq("id", clientId)
        .maybeSingle();

      let targetFolderId = client?.google_drive_folder_id;

      // Create root folder if missing
      if (!targetFolderId) {
        const rootName = (clientName || "Unnamed Client").trim();
        const createRes = await driveFetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: rootName, mimeType: "application/vnd.google-apps.folder" })
        });
        const createData = await createRes.json();
        targetFolderId = createData.id;

        if (clientId && targetFolderId) {
          await supabase.from("workspace_clients").update({ google_drive_folder_id: targetFolderId }).eq("id", clientId);
        }
      }

      

      // 2. Resolve target subfolder (e.g., "App Snapshots" or "Task Attachments")
      const targetSubfolder = subfolderName || "Task Attachments";
      const subQ = `mimeType='application/vnd.google-apps.folder' and name='${targetSubfolder}' and '${targetFolderId}' in parents and trashed=false`;
      const subSearch = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subQ)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const subData = await subSearch.json();
      let parentFolderId = subData.files?.[0]?.id;

      if (!parentFolderId) {
        const subCreate = await driveFetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: targetSubfolder, mimeType: "application/vnd.google-apps.folder", parents: [targetFolderId] })
        });
        const subCreateData = await subCreate.json();
        parentFolderId = subCreateData.id;
      }

      // 3. Convert base64 data back to Blob
      const base64Data = fileData.split(",")[1] || fileData;
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const blob = new Blob([binaryData], { type: fileType || "application/octet-stream" });

      // 4. Upload file to Google Drive multipart endpoint
      const metadata = { name: fileName, parents: [parentFolderId] };
      const formData = new FormData();
      formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      formData.append("file", blob);

      const uploadRes = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });

      const uploadData = await uploadRes.json();
      return new Response(JSON.stringify({ 
        success: true, 
        fileId: uploadData.id, 
        webViewLink: uploadData.webViewLink 
      }), { status: 200, headers: corsHeaders });
    }

    // Inside google-drive-sync index.ts serve handler...
    if (action === "upload_global_snapshot") {
      const { fileName, fileData, fileType } = body;

      // 1. Search for Global Master Snapshots Root Folder
      const rootQuery = `mimeType='application/vnd.google-apps.folder' and name='Global Master SOP Snapshots' and trashed=false`;
      const rootSearch = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(rootQuery)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const rootData = await rootSearch.json();
      let globalFolderId = rootData.files?.[0]?.id;

      // 2. Create Global Folder if it doesn't exist yet
      if (!globalFolderId) {
        const createRes = await driveFetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Global Master SOP Snapshots", mimeType: "application/vnd.google-apps.folder" })
        });
        const createData = await createRes.json();
        globalFolderId = createData.id;
      }

      // 3. Convert base64 data to binary Blob
      const base64Data = fileData.split(",")[1] || fileData;
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const blob = new Blob([binaryData], { type: fileType || "image/png" });

      // 4. Upload file to Google Drive
      const metadata = { name: fileName, parents: [globalFolderId] };
      const formData = new FormData();
      formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      formData.append("file", blob);

      const uploadRes = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });

      const uploadData = await uploadRes.json();

      if (!uploadRes.ok || !uploadData.id) {
        return new Response(JSON.stringify({ 
          error: "upload_failed", 
          message: uploadData.error?.message || "Failed to upload image to Google Drive." 
        }), { status: 400, headers: corsHeaders });
      }

      // Make file publicly viewable so the image can render in img src tags
      await driveFetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" })
      });

      // Construct direct high-res image view URL
      const directImageUrl = `https://lh3.googleusercontent.com/d/${uploadData.id}`;

      return new Response(JSON.stringify({ 
        success: true, 
        fileId: uploadData.id, 
        url: directImageUrl 
      }), { status: 200, headers: corsHeaders });
    }
    
    // =========================================================================
    // ACTION 3: Get or Create Client Folder Structure
    // =========================================================================
    if (action === "get_or_create_client_folder") {
      const folderName = (clientName || "Unnamed Client").trim();
      const safeName = folderName.replace(/'/g, "\\'");

      // Search for existing root client folder
      const query = `mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`;
      const searchRes = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
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

      // Create root folder if missing
      if (!targetFolderId) {
        const createRes = await driveFetch("https://www.googleapis.com/drive/v3/files", {
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

      // Ensure standard subfolders exist
      const subfolders = ["Zoom Recordings", "Task Attachments", "App Snapshots"];
      const subfolderIds: Record<string, string> = {};

      for (const subName of subfolders) {
        const subQuery = `mimeType='application/vnd.google-apps.folder' and name='${subName}' and '${targetFolderId}' in parents and trashed=false`;
        const subSearchRes = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subQuery)}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const subSearchData = await subSearchRes.json();

        if (subSearchData.files?.[0]?.id) {
          subfolderIds[subName] = subSearchData.files[0].id;
        } else {
          const subCreateRes = await driveFetch("https://www.googleapis.com/drive/v3/files", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: subName, mimeType: "application/vnd.google-apps.folder", parents: [targetFolderId] })
          });
          const subCreateData = await subCreateRes.json();
          subfolderIds[subName] = subCreateData.id;
        }
      }

      // Save folder ID directly to workspace_clients DB table if clientId provided
      if (targetClientId) {
        await supabase
          .from("workspace_clients")
          .update({ google_drive_folder_id: targetFolderId })
          .eq("id", targetClientId);
      }

      return new Response(JSON.stringify({ folderId: targetFolderId, subfolders: subfolderIds }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "invalid_action", message: "Action must be get_or_create_client_folder, save_text_doc, or upload_zoom_recording" }), { status: 400, headers: corsHeaders });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: "server_crash", message: err.message }), { status: 500, headers: corsHeaders });
  }
});
