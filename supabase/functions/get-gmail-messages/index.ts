import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";
import { loadProjectRules, matchProjectRules } from "../_shared/project-rules.ts";

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

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

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

function extractEmails(text: string): string[] {
  if (!text) return [];
  const matches = text.match(EMAIL_RE) || [];
  return matches.map((e) => e.toLowerCase());
}

// ---- Zapier error email detection + best-effort parsing ----
// This is a fallback for existing "send me an error email" Zaps. It's
// inherently fragile (regex over free text) — if you switch a Zap's error
// step to POST straight to the error-webhook function instead, that path
// skips all of this and is far more reliable. Kept here so errors still
// land in the centralized log even before you've migrated a given client's Zap.
function isZapierErrorEmail(sender: string, subject: string): boolean {
  const s = (sender || "").toLowerCase();
  const subj = (subject || "").toLowerCase();
  return s.includes("zapiermail.com") || subj.includes("zapier error");
}

const ZAP_ERROR_LABELS = ["Title", "Message", "History Link", "Zap Link", "Service", "Root ID", "Outage", "Count", "Sheet ID"];

function parseZapierErrorBody(body: string): Record<string, string> {
  const clean = (body || "").replace(/\r/g, " ").replace(/\s+/g, " ").trim();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const result: Record<string, string> = {};

  for (let i = 0; i < ZAP_ERROR_LABELS.length; i++) {
    const label = ZAP_ERROR_LABELS[i];
    const rest = ZAP_ERROR_LABELS.slice(i + 1).map(esc).join("|");
    const re = new RegExp(esc(label) + "\\s*:\\s*(.*?)" + (rest ? "(?=\\s(?:" + rest + ")\\s*:)" : "$"), "i");
    const m = clean.match(re);
    if (m) result[label] = m[1].trim();
  }
  return result;
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

// ---- Project label rules: which clients want auto-labeling, and which
// email addresses (their Team tab) identify a message as belonging to them.
// (loadProjectRules/matchProjectRules now live in ../_shared/project-rules.ts,
// shared with get-calendar-events.)

// ---- Gmail label lookup/creation, cached for the duration of one sync run ----
async function loadExistingLabels(accessToken: string): Promise<Map<string, string>> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  const map = new Map<string, string>();
  (data.labels || []).forEach((l: any) => map.set(l.name.toLowerCase(), l.id));
  return map;
}

async function ensureLabelId(accessToken: string, labelCache: Map<string, string>, labelName: string): Promise<string | null> {
  const key = labelName.toLowerCase();
  if (labelCache.has(key)) return labelCache.get(key)!;

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: labelName, labelListVisibility: "labelShow", messageListVisibility: "show" })
  });

  if (!res.ok) {
    // Most likely: another concurrent sync created it a moment ago — re-check.
    const refreshed = await loadExistingLabels(accessToken);
    if (refreshed.has(key)) {
      labelCache.set(key, refreshed.get(key)!);
      return refreshed.get(key)!;
    }
    console.error(`Failed to create Gmail label "${labelName}":`, await res.text());
    return null;
  }

  const created = await res.json();
  labelCache.set(key, created.id);
  return created.id;
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
      return new Response(JSON.stringify({ scannedCount: 0, importedCount: 0, labeledCount: 0 }), { status: 200, headers: corsHeaders });
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
      return new Response(JSON.stringify({ scannedCount: inboxIds.length, importedCount: 0, labeledCount: 0 }), { status: 200, headers: corsHeaders });
    }

    // 3. Load project label-matching rules (client Gmail-label config + Team emails)
    const projectRules = await loadProjectRules(supabase);

    // Lightweight client directory for error-email matching (by Sheet ID
    // primarily, falling back to a name found in the subject line).
    const { data: clientDirectory } = await supabase.from("workspace_clients").select("id, meta");
    const sheetIdToClient = new Map<string, string>();
    (clientDirectory || []).forEach((c: any) => {
      const sid = c.meta?.errorSheetId;
      if (sid) sheetIdToClient.set(sid, c.id);
    });

    // 4. Fetch full detail + body for each new message, and work out which
    // project(s) it matches by comparing From/To/Cc addresses to each
    // project's Team tab emails.
    const rows: any[] = [];
    const labelPlan: { id: string; labelNames: string[] }[] = [];
    const errorRows: any[] = [];

    await Promise.all(
      newIds.map(async (id) => {
        const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const detail = await detailRes.json();

        const headers = detail.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
        const subject = getHeader("Subject") || "No Subject";
        const sender = getHeader("From") || "Unknown";
        const dateHeader = getHeader("Date");
        const parsedDate = dateHeader ? new Date(dateHeader) : null;
        const body = extractPlainTextBody(detail.payload);

        const participantEmails = new Set([
          ...extractEmails(getHeader("From")),
          ...extractEmails(getHeader("To")),
          ...extractEmails(getHeader("Cc"))
        ]);

        const matchedRules = matchProjectRules(projectRules, participantEmails);
        const matchedClientIds = matchedRules.map((r) => r.clientId);
        const matchedLabelNames = matchedRules.map((r) => r.labelName);

        rows.push({
          id,
          thread_id: detail.threadId || null,
          sender,
          subject,
          snippet: detail.snippet || "",
          body: body.slice(0, 20000),
          date: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
          // Only auto-link when exactly one project matches — ambiguous
          // matches are left for manual linking rather than guessed.
          linked_client_id: matchedClientIds.length === 1 ? matchedClientIds[0] : null
        });

        if (matchedLabelNames.length > 0) {
          labelPlan.push({ id, labelNames: [...new Set(matchedLabelNames)] });
        }

        if (isZapierErrorEmail(sender, subject)) {
          const parsed = parseZapierErrorBody(body);
          const sheetId = parsed["Sheet ID"] || null;

          let errorClientId: string | null = (sheetId && sheetIdToClient.get(sheetId)) || null;
          if (!errorClientId) {
            // Fall back to a fuzzy match against the subject line, e.g.
            // "Brent Hamilton - Zapier Error" -> "Brent Hamilton".
            const subjectName = subject.split(/[-–]/)[0].trim().toLowerCase();
            const match = (clientDirectory || []).find((c: any) => {
              const n = (c.meta?.name || "").toLowerCase();
              return n && subjectName && (n.includes(subjectName) || subjectName.includes(n));
            });
            if (match) errorClientId = match.id;
          }

          errorRows.push({
            client_id: errorClientId,
            source: "email",
            title: parsed["Title"] || null,
            message: parsed["Message"] || body.slice(0, 2000),
            service: parsed["Service"] || null,
            history_link: parsed["History Link"] || null,
            zap_link: parsed["Zap Link"] || null,
            root_id: parsed["Root ID"] || null,
            outage: parsed["Outage"] !== undefined ? parsed["Outage"].toLowerCase() === "true" : null,
            occurrence_count: parsed["Count"] ? Number(parsed["Count"]) : null,
            sheet_id: sheetId,
            occurred_at: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString(),
            gmail_message_id: id
          });
        }
      })
    );

    // 5. Save them (upsert guards against a race if two syncs overlap).
    // Note: importing does NOT touch the real Gmail inbox — these stay in
    // Gmail until explicitly archived (see the separate archive-gmail-message
    // function, triggered from the app when a message is archived/linked).
    const { error: insertError } = await supabase.from("gmail_messages").upsert(rows, { onConflict: "id" });
    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    // 5b. Save any detected Zapier error emails into the centralized error
    // log. ignoreDuplicates + the unique index on gmail_message_id means a
    // re-synced/re-labeled email never creates a second row.
    let errorsLogged = 0;
    if (errorRows.length > 0) {
      const { error: errorInsertError, count } = await supabase
        .from("error_log")
        .upsert(errorRows, { onConflict: "gmail_message_id", ignoreDuplicates: true, count: "exact" });
      if (errorInsertError) console.error("Failed to log parsed errors:", errorInsertError.message);
      else errorsLogged = count ?? errorRows.length;
    }

    // 6. Apply Gmail labels for any project matches (creating labels on
    // first use, named after the project — editable later from Project
    // Settings, which just renames the same Gmail label going forward).
    let labeledCount = 0;
    if (labelPlan.length > 0) {
      const labelCache = await loadExistingLabels(accessToken);

      await Promise.all(
        labelPlan.map(async ({ id, labelNames }) => {
          const labelIds = (
            await Promise.all(labelNames.map((name) => ensureLabelId(accessToken, labelCache, name)))
          ).filter((x): x is string => !!x);

          if (labelIds.length === 0) return;

          try {
            const modRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ addLabelIds: labelIds })
            });
            if (modRes.ok) labeledCount++;
            else console.error(`Failed to label message ${id}:`, await modRes.text());
          } catch (e) {
            console.error(`Failed to label message ${id}:`, e);
          }
        })
      );
    }

    return new Response(
      JSON.stringify({ scannedCount: inboxIds.length, importedCount: newIds.length, labeledCount, errorsLogged }),
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
