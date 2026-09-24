// ================================================================================================
// FUNCTION: get-gmail-messages
//
// WHAT IT DOES:   The Gmail sync. Looks at up to 300 recent Inbox and Sent messages,
//                 downloads only the ones not stored yet, saves them (text and
//                 formatted body), links each to a client project by matching
//                 addresses on the Team tab, applies Gmail labels for projects that
//                 want them, and logs Zapier error emails into error_log.
//
// CALLED BY:      The Sync Gmail button, the app's 5-minute auto-sync while a tab is
//                 open, and the ol_sync_gmail cron job (every 10 minutes).
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member (the app sends the login
//                 token), or the scheduled sync job, which sends the service role key
//                 or the CRON_SECRET in an x-cron-secret header. Anyone else gets 401
//                 or 403 and nothing happens.
//
// READS/CHANGES:  Reads Gmail. Adds rows to gmail_messages and error_log. Adds labels
//                 to messages in Gmail.
//
// NEEDS:          _shared/google-token.ts (the stored Google connection),
//                 _shared/auth.ts, _shared/project-rules.ts,
//                 _shared/resource-match.ts. Labeling needs Google's gmail.modify
//                 permission.
//
// CHANGED FROM THE ORIGINAL: Added the login check, and acceptance of the scheduled
//                            sync's secret.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";
import { loadProjectRules, matchProjectRules, matchProjectRulesByText } from "../_shared/project-rules.ts";
import { matchResourceByRootId } from "../_shared/resource-match.ts";

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

function extractGmailHeaders(headers: any[]) {
  const map: Record<string, string> = {};
  (headers || []).forEach((h: any) => {
    if (h.name && h.value) map[h.name.toLowerCase()] = h.value;
  });
  return {
    from: map['from'] || map['reply-to'] || null,
    to: map['to'] || null,
    cc: map['cc'] || null,
    bcc: map['bcc'] || null,
    subject: map['subject'] || '(No Subject)'
  };
}

function extractPlainTextBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  // 🚀 THE FIX: a single-part text/html message (no multipart "parts" array
  // at all — Calendly notifications and a lot of other automated senders
  // send exactly this) used to fall straight through every branch below and
  // return the raw, undecoded HTML source as the "body".
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

async function fetchAndConvertCidImages(
  payload: any,
  html: string,
  messageId: string,
  accessToken: string
): Promise<string> {
  if (!payload || !html || !html.includes("cid:")) return html;

  let updatedHtml = html;
  const partsToProcess: { cid: string; mimeType: string; attachmentId?: string; data?: string }[] = [];

  function collectParts(node: any) {
    if (!node) return;

    if (node.headers && Array.isArray(node.headers)) {
      const cidHeader = node.headers.find(
        (h: any) => h.name && h.name.toLowerCase() === "content-id"
      );
      if (cidHeader && cidHeader.value) {
        // Strip angle brackets and whitespace from CID
        const cid = cidHeader.value.replace(/[<>]/g, "").trim();
        const mimeType = node.mimeType || "image/png";

        if (node.body?.data) {
          partsToProcess.push({ cid, mimeType, data: node.body.data });
        } else if (node.body?.attachmentId) {
          partsToProcess.push({ cid, mimeType, attachmentId: node.body.attachmentId });
        }
      }
    }

    if (Array.isArray(node.parts)) {
      node.parts.forEach(collectParts);
    }
  }

  collectParts(payload);

  for (const item of partsToProcess) {
    try {
      let base64Data = item.data;

      if (!base64Data && item.attachmentId) {
        const attachRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${item.attachmentId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (attachRes.ok) {
          const attachData = await attachRes.json();
          base64Data = attachData?.data || null;
        }
      }

      // Guard: only attempt string manipulation if valid base64 data exists
      if (base64Data && typeof base64Data === "string") {
        const normalizedBase64 = base64Data.replace(/-/g, "+").replace(/_/g, "/");
        const dataUri = `data:${item.mimeType};base64,${normalizedBase64}`;

        // Safe replace without RegExp or replaceAll syntax errors
        const targetCidStr = `cid:${item.cid}`;
        while (updatedHtml.includes(targetCidStr)) {
          updatedHtml = updatedHtml.replace(targetCidStr, dataUri);
        }
      }
    } catch (err) {
      console.error(`Error processing inline image for CID ${item.cid}:`, err);
    }
  }

  return updatedHtml;
}

// Same traversal as extractPlainTextBody, but keeps the HTML instead of
// stripping it — this is what lets the app render actual formatting
// (bold, links, lists, etc.) instead of the flattened plain-text version.
// Returns "" for plain-text-only messages, which is the normal/expected
// case for a lot of senders, not a bug.
// Update signature to accept messageId and accessToken
async function extractHtmlBody(
  payload: any,
  messageId: string,
  accessToken: string,
  rootPayload: any = payload
): Promise<string> {
  if (!payload) return "";

  let rawHtml = "";

  if (payload.mimeType === "text/html" && payload.body?.data) {
    rawHtml = decodeBase64Url(payload.body.data);
  } else if (Array.isArray(payload.parts)) {
    // 1. First pass: direct text/html child
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        rawHtml = decodeBase64Url(part.body.data);
        break;
      }
    }
    // 2. Second pass: search recursively in deeper nested parts (multipart/related, multipart/mixed)
    if (!rawHtml) {
      for (const part of payload.parts) {
        const nested = await extractHtmlBody(part, messageId, accessToken, rootPayload);
        if (nested) {
          rawHtml = nested;
          break;
        }
      }
    }
  }

  if (!rawHtml) return "";

  return await fetchAndConvertCidImages(rootPayload, rawHtml, messageId, accessToken);
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
    // 🚀 THE FIX: was labelIds=INBOX only, so anything you sent (label
    // SENT, not INBOX) never synced in. labelIds requires ALL listed
    // labels to be present, which can't express "either" — a search
    // query can. This pulls both directions of every conversation.
    url.searchParams.set("q", "in:inbox OR in:sent");
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

// ---- Gmail -> app reconciliation ----------------------------------------
// The sync used to only ever ADD rows. Archiving or deleting something in
// Gmail itself never reached the app, so "bi-directional" only worked one
// way. This pass mirrors Gmail's current state back:
//   - a conversation that is no longer in the Gmail inbox (archived there)
//     -> ONLY its most recent message is archived in the app. Older
//     messages in the same thread are left as they are.
//   - one that's in Trash / gone from Gmail -> removed from the app, unless
//     it carries links or a note (then it's archived instead, so nothing
//     tied to a task silently disappears)
//   - an app row archived via Gmail (archived_in_gmail) whose conversation
//     is back in the inbox -> restored in the app
// Sent-only messages (never in the inbox) are left alone.
const RECONCILE_LOOKBACK_DAYS = 21;
const RECONCILE_MAX_CHECKS = 60;

async function listInboxThreadIds(accessToken: string): Promise<Set<string>> {
  const threads = new Set<string>();
  let pageToken: string | undefined;
  let page = 0;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", "in:inbox");
    url.searchParams.set("maxResults", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) throw new GoogleAuthError("Google rejected the token while listing the inbox.");
    const data = await res.json();
    (data.messages || []).forEach((m: any) => m.threadId && threads.add(m.threadId));
    pageToken = data.nextPageToken;
    page++;
  } while (pageToken && page < 3);
  return threads;
}

async function reconcileWithGmail(supabase: any, accessToken: string) {
  const out = { archived: 0, removed: 0, restored: 0 };
  const inboxThreads = await listInboxThreadIds(accessToken);
  const since = new Date(Date.now() - RECONCILE_LOOKBACK_DAYS * 86400000).toISOString();

  // 1. Restores: archived here because Gmail archived it, and it's back in the inbox now.
  const { data: archivedRows } = await supabase.from("gmail_messages")
    .select("id, thread_id")
    .eq("archived", true).eq("archived_in_gmail", true)
    .gte("date", since).limit(500);
  // The conversation being in the inbox isn't enough: the app archives a
  // single linked message while the rest of its thread stays in the inbox.
  // Restore only messages that THEMSELVES carry the INBOX label again.
  const restoreCandidates = (archivedRows || []).filter((r: any) => r.thread_id && inboxThreads.has(r.thread_id)).slice(0, 40);
  const toRestore: string[] = [];
  await Promise.all(restoreCandidates.map(async (r: any) => {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${r.id}?format=minimal`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return;
    const msg = await res.json();
    if ((msg.labelIds || []).includes("INBOX")) toRestore.push(r.id);
  }));
  if (toRestore.length) {
    await supabase.from("gmail_messages").update({ archived: false, archived_in_gmail: false }).in("id", toRestore);
    out.restored = toRestore.length;
  }

  // 2. Archives/removals: unarchived here, conversation not in the inbox.
  const { data: liveRows } = await supabase.from("gmail_messages")
    .select("id, thread_id, linked_client_id, linked_task_id, linked_resource_id, linked_request_id, linked_event_id, note")
    .eq("archived", false)
    .gte("date", since)
    .order("date", { ascending: false })
    .limit(500);
  const outOfInbox = (liveRows || []).filter((r: any) => !r.thread_id || !inboxThreads.has(r.thread_id));

  // A Gmail thread archive only archives the thread's MOST RECENT message
  // here. "Most recent" is across every app row in the thread, archived or
  // not, so an older message never inherits the archive just because the
  // newest one was already archived.
  const latestByThread = new Map<string, { id: string; date: string }>();
  const threadIds = [...new Set(outOfInbox.map((r: any) => r.thread_id).filter(Boolean))] as string[];
  for (let i = 0; i < threadIds.length; i += 100) {
    const { data: threadRows } = await supabase.from("gmail_messages")
      .select("id, thread_id, date")
      .in("thread_id", threadIds.slice(i, i + 100));
    (threadRows || []).forEach((t: any) => {
      const cur = latestByThread.get(t.thread_id);
      if (!cur || new Date(t.date).getTime() > new Date(cur.date).getTime()) latestByThread.set(t.thread_id, { id: t.id, date: t.date });
    });
  }
  const isLatestInThread = (r: any) => !r.thread_id || latestByThread.get(r.thread_id)?.id === r.id;

  // Latest-in-thread rows are checked first. Older rows are still checked
  // (after them, within the cap) but only so a trashed/deleted message is
  // still removed — they are never archived because of a thread archive.
  const candidates = [
    ...outOfInbox.filter(isLatestInThread),
    ...outOfInbox.filter((r: any) => !isLatestInThread(r))
  ].slice(0, RECONCILE_MAX_CHECKS);

  const archiveIds: string[] = [];
  const removeIds: string[] = [];
  const CONC = 8;
  for (let i = 0; i < candidates.length; i += CONC) {
    await Promise.all(candidates.slice(i, i + CONC).map(async (row: any) => {
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${row.id}?format=minimal`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const hasLinks = !!(row.linked_client_id || row.linked_task_id || row.linked_resource_id || row.linked_request_id || row.linked_event_id || row.note);
      if (res.status === 404) { (hasLinks ? archiveIds : removeIds).push(row.id); return; }
      if (!res.ok) return; // transient — try again next run
      const msg = await res.json();
      const labels: string[] = msg.labelIds || [];
      if (labels.includes("TRASH") || labels.includes("SPAM")) { (hasLinks ? archiveIds : removeIds).push(row.id); return; }
      if (labels.includes("INBOX")) return;
      if (labels.includes("SENT")) return; // sent-only, never was in the inbox
      if (!isLatestInThread(row)) return; // older message: thread archive doesn't touch it
      archiveIds.push(row.id);
    }));
  }
  if (archiveIds.length) {
    await supabase.from("gmail_messages").update({ archived: true, archived_in_gmail: true }).in("id", archiveIds);
    out.archived = archiveIds.length;
  }
  if (removeIds.length) {
    await supabase.from("gmail_messages").delete().in("id", removeIds);
    out.removed = removeIds.length;
  }
  return out;
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

// Auth: a signed-in Sphynx admin or team member (Authorization: Bearer <login token>), or the scheduled
// sync calling with the service role key as the bearer token or a CRON_SECRET in the x-cron-secret
// header (see ../_shared/auth.ts). Anyone else gets 401 or 403 and nothing happens.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Who is calling? Nothing else happens until this passes.
    const authz = await authorizeTeamRequest(req, supabase, {
      serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      cronSecret: Deno.env.get("CRON_SECRET")
    });
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error, message: authz.message }), { status: authz.status, headers: corsHeaders });
    }

    const accessToken = await getFreshGoogleAccessToken(supabase);

    // 0. Mirror Gmail-side archives/deletes/restores back into the app.
    // Runs every sync (before the "nothing new" early return below, which
    // is what used to skip it). Failures here never block importing.
    let reconciled = { archived: 0, removed: 0, restored: 0 };
    try { reconciled = await reconcileWithGmail(supabase, accessToken); }
    catch (e: any) {
      if (e instanceof GoogleAuthError) throw e;
      console.error("Gmail reconcile failed (import continues):", e?.message || e);
    }

    // 1. List current inbox message ids (paginated)
    const inboxIds = await listInboxMessageIds(accessToken);

    if (inboxIds.length === 0) {
      return new Response(JSON.stringify({ scannedCount: 0, importedCount: 0, labeledCount: 0, reconciled }), { status: 200, headers: corsHeaders });
    }

    // 2. Find which ones we've already imported (chunk the .in() filter to be safe on size)
    const alreadyImported = new Set<string>();
    for (let i = 0; i < inboxIds.length; i += 200) {
      const chunk = inboxIds.slice(i, i + 200);
      const { data, error } = await supabase.from("gmail_messages").select("id").in("id", chunk);
      if (error) throw new Error(`Lookup failed: ${error.message}`);
      (data || []).forEach((r: any) => alreadyImported.add(r.id));
    }

    // 🚀 THE FIX: this used to be `const newIds = inboxIds` — i.e. every
    // message in the inbox+sent listing (up to MAX_LIST_PAGES *
    // LIST_PAGE_SIZE = 300) was re-fetched in full, re-decoded, and had its
    // inline images re-downloaded and re-inlined on EVERY sync click, not
    // just genuinely new messages. That unbounded per-run memory/network
    // cost is what was tripping the edge function's resource limit (HTTP
    // 546). Now we only do the expensive work for ids not already in
    // gmail_messages.
    const newIds = inboxIds.filter((id) => !alreadyImported.has(id));

    if (newIds.length === 0) {
      return new Response(JSON.stringify({ scannedCount: inboxIds.length, importedCount: 0, labeledCount: 0, reconciled }), { status: 200, headers: corsHeaders });
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

    // Process in bounded-size batches rather than firing every message's
    // fetch (detail + any inline-image attachment fetches + base64 decode)
    // all at once. With genuinely new messages now filtered above this is
    // usually small anyway, but a big backlog (first sync, or after a gap)
    // can still be 100+ messages, and any of them holding embedded images
    // as base64 in memory simultaneously is what was pushing the function
    // over its resource limit.
    const FETCH_CONCURRENCY = 8;
    for (let i = 0; i < newIds.length; i += FETCH_CONCURRENCY) {
      const batch = newIds.slice(i, i + FETCH_CONCURRENCY);
      await Promise.all(
        batch.map(async (id) => {
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
        const bodyHtml = await extractHtmlBody(detail.payload, id, accessToken);

        const participantEmails = new Set([
          ...extractEmails(getHeader("From")),
          ...extractEmails(getHeader("To")),
          ...extractEmails(getHeader("Cc")),
          ...extractEmails(getHeader("Bcc"))
        ]);

        const toHeader = getHeader("To") || getHeader("Delivered-To") || "";
        const ccHeader = getHeader("Cc") || "";
        const bccHeader = getHeader("Bcc") || "";

        // 1. Exclude internal team emails & domain exclusions from the matching pool
        const externalParticipants = new Set(
          Array.from(participantEmails).filter((email) => {
            const clean = email.toLowerCase().trim();
            return !clean.endsWith("@sphynxautomation.com") && !clean.includes("no-reply");
          })
        );

        // 2. Loop through participants to match client project rules
        const matchedRules = (() => {
          const byEmail = matchProjectRules(projectRules, externalParticipants);
          if (byEmail.length > 0) return byEmail;

          // Fallback to subject/body text matching
          const byText = matchProjectRulesByText(projectRules, `${subject} ${body}`);
          return byText;
        })();

        const matchedClientIds = Array.from(new Set(matchedRules.map((r) => r.clientId)));

        // 3. Auto-link to the primary matched client (or the first matched client if multiple exist)
        const primaryLinkedClientId = matchedClientIds.length > 0 ? matchedClientIds[0] : null;

        const matchedLabelNames = matchedRules.filter((r) => r.labelingEnabled).map((r) => r.labelName);

        rows.push({
          id,
          thread_id: detail.threadId || null,
          sender,
          recipient_to: toHeader,
          recipient_cc: ccHeader,
          recipient_bcc: bccHeader,
          subject,
          snippet: detail.snippet || "",
          body: body.slice(0, 20000),
          // Capped well above what any real email needs (most are under a
          // few KB), just guarding against a pathological inline-everything
          // marketing email blowing up row size.
          body_html: bodyHtml ? bodyHtml.slice(0, 100000) : null,
          date: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
          participants: Array.from(participantEmails),
          linked_client_id: primaryLinkedClientId
        });

        if (matchedLabelNames.length > 0) {
          labelPlan.push({ id, labelNames: matchedLabelNames });
        }

        if (isZapierErrorEmail(sender, subject)) {
          const parsed = parseZapierErrorBody(body);
          const sheetId = parsed["Sheet ID"] || null;
          const rootId = parsed["Root ID"] || null;

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

          // Auto-match to a specific resource (e.g. the Zap itself) within
          // that project, by finding a resource whose External Link
          // contains this error's root_id.
          const resourceMatch = errorClientId ? await matchResourceByRootId(supabase, errorClientId, rootId) : null;

          errorRows.push({
            client_id: errorClientId,
            source: "email",
            title: parsed["Title"] || null,
            message: parsed["Message"] || body.slice(0, 2000),
            service: parsed["Service"] || null,
            history_link: parsed["History Link"] || null,
            zap_link: parsed["Zap Link"] || null,
            root_id: rootId,
            outage: parsed["Outage"] !== undefined ? parsed["Outage"].toLowerCase() === "true" : null,
            occurrence_count: parsed["Count"] ? Number(parsed["Count"]) : null,
            sheet_id: sheetId,
            occurred_at: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString(),
            gmail_message_id: id,
            resource_id: resourceMatch?.id || null,
            resource_name: resourceMatch?.name || null
          });
        }
        })
      );
    }

    // 5. Save them (upsert guards against a race if two syncs overlap).
    // Ensure upsert updates the content columns for existing rows
    const { error: insertError } = await supabase
      .from("gmail_messages")
      .upsert(rows, { 
        onConflict: "id", 
        ignoreDuplicates: false 
      });
    
    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    // 5b. Save any detected Zapier error emails into the centralized error log.
    let errorsLogged = 0;
    if (errorRows.length > 0) {
      const { error: errorInsertError, count } = await supabase
        .from("error_log")
        .upsert(errorRows, { onConflict: "gmail_message_id", ignoreDuplicates: true, count: "exact" });
      if (errorInsertError) console.error("Failed to log parsed errors:", errorInsertError.message);
      else errorsLogged = count ?? errorRows.length;
    }

    // 6. Apply Gmail labels for any project matches
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
      JSON.stringify({ scannedCount: inboxIds.length, importedCount: newIds.length, labeledCount, errorsLogged, reconciled }),
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
