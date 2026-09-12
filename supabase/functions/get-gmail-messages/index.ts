import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

// Safety caps for a single sync run (edge functions have a wall-clock limit,
// and Gmail's own per-message quota cost adds up). At ~100 emails/day this
// comfortably covers even a few days of backlog in one run; anything left
// over just gets picked up on the next "Sync Gmail" click.
const MAX_LIST_PAGES = 3;
const LIST_PAGE_SIZE = 100;

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeURIComponent(escape(atob(base64)));
  } catch {
    return atob(base64);
  }
}

function extractPlainTextBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
    }
    for (const part of payload.parts) {
      const nested = extractPlainTextBody(part);
      if (nested) return nested;
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
  }
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

async function listInboxMessageIds(accessToken: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let page = 0;

  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("labelIds", "INBOX");
    url.searchParams.set("maxResults", String(LIST_PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) throw new GoogleAuthError("Google rejected the token while listing messages.");
    const data = await res.json();

    (data.messages || []).forEach((m: any) => ids.push(m.id));
    pageToken = data.nextPageToken;
    page++;
  } while (pageToken && page < MAX_LIST_PAGES);

  return ids;
}

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

    // 1. List current inbox message ids (paginated)
    const inboxIds = await listInboxMessageIds(accessToken);

    if (inboxIds.length === 0) {
      return new Response(JSON.stringify({ scannedCount: 0, importedCount: 0 }), { status: 200, headers: corsHeaders });
    }

    // 2. Find which ones we've already imported (chunk the .in() filter to be safe on size)
    const alreadyImported = new Set<string>();
    for (let i = 0; i < inboxIds.length; i += 200) {
      const chunk = inboxIds.slice(i, i + 200);
      const { data, error } = await supabase.from("gmail_messages").select("id").in("id", chunk);
      if (error) throw new Error(`Lookup failed: ${error.message}`);
      (data || []).forEach((r: any) => alreadyImported.add(r.id));
    }

    const newIds = inboxIds.filter((id) => !alreadyImported.has(id));

    if (newIds.length === 0) {
      return new Response(JSON.stringify({ scannedCount: inboxIds.length, importedCount: 0 }), { status: 200, headers: corsHeaders });
    }

    // 3. Fetch full detail + body for each new message
    const rows = await Promise.all(
      newIds.map(async (id) => {
        const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const detail = await detailRes.json();

        const headers = detail.payload?.headers || [];
        const subject = headers.find((h: any) => h.name === "Subject")?.value || "No Subject";
        const sender = headers.find((h: any) => h.name === "From")?.value || "Unknown";
        const dateHeader = headers.find((h: any) => h.name === "Date")?.value || "";
        const parsedDate = dateHeader ? new Date(dateHeader) : null;

        return {
          id,
          thread_id: detail.threadId || null,
          sender,
          subject,
          snippet: detail.snippet || "",
          body: extractPlainTextBody(detail.payload).slice(0, 20000),
          date: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null
        };
      })
    );

    // 4. Save them (upsert guards against a race if two syncs overlap).
    // Note: importing does NOT touch the real Gmail inbox — these stay in
    // Gmail until explicitly archived (see the separate archive-gmail-message
    // function, triggered from the app when a message is archived/linked).
    const { error: insertError } = await supabase.from("gmail_messages").upsert(rows, { onConflict: "id" });
    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    return new Response(
      JSON.stringify({ scannedCount: inboxIds.length, importedCount: newIds.length }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err: any) {
    const isAuthErr = err instanceof GoogleAuthError;
    console.error(isAuthErr ? "Gmail Auth Error:" : "Gmail Sync Error:", err.message);
    return new Response(
      JSON.stringify({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }),
      { status: isAuthErr ? 401 : 500, headers: corsHeaders }
    );
  }
});
