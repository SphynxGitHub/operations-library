// ================================================================================================
// FUNCTION: send-gmail-message
//
// WHAT IT DOES:   Sends one email from the connected Gmail account, as plain text and
//                 optionally with attachments (PDF, PNG, JPEG, text, CSV; up to 5
//                 files, 15 MB total). Can reply into an existing thread. Saves a copy
//                 in gmail_messages so it shows in the app right away.
//
// CALLED BY:      The Compose window in Communications, and the Meeting summary email
//                 window.
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member (the app sends the login
//                 token). Anyone else gets 401 or 403 and nothing happens.
//
// READS/CHANGES:  Sends through the Gmail API. Adds a row to gmail_messages, linked to
//                 the client, meeting or task that was passed in.
//
// NEEDS:          _shared/google-token.ts (the stored Google connection),
//                 _shared/auth.ts, _shared/mime.ts (builds the email). Needs Google's
//                 send permission.
//
// CHANGED FROM THE ORIGINAL: Added the login check, attachment support, and removal of
//                            line breaks from the To, Cc and Subject values.
// ================================================================================================

// POST /functions/v1/send-gmail-message
// Auth: Authorization: Bearer <the caller's Supabase login token>. The caller must be an admin or a
// Sphynx team member (see ../_shared/auth.ts). Anyone else gets 401 or 403 and nothing is sent.
// Body: { to, cc?, subject, body, threadId?, replyToMessageId?,
//         attachments?: [{ filename, mimeType, contentBase64 }],
//         linked_client_id?, linked_resource_id?, linked_task_id?, linked_event_id? }
//
// Sends a plain-text email (optionally with attachments) through the connected Gmail account, using the
// same OAuth connection (and token-refresh helper) as the Gmail sync.
// Requires the gmail.send scope, added alongside gmail.readonly in
// google-auth-login — an account connected before that change needs to be
// reconnected (click "Connect Google Account" again) before sending will
// work; a stored refresh token doesn't retroactively gain a new scope.
//
// Two special things this does beyond a bare send:
//   - If replyToMessageId is given, it fetches that message's real RFC 822
//     Message-ID header (Gmail's own numeric id doesn't work for this) and
//     sets In-Reply-To/References so Gmail (and the recipient's client)
//     threads it as a reply instead of a new conversation.
//   - Attachments (PDF, PNG, JPEG, text or CSV; up to 5 files, 10 MB each, 15 MB in total) turn the
//     message into multipart/mixed. Without attachments the message is built exactly as before.
//     Header values have line breaks removed so a caller cannot add headers of their own.
//   - It immediately inserts a local copy into gmail_messages with
//     whichever linked_client_id/resource/task/event was passed in, so the
//     sent message shows up in the app right away rather than waiting for
//     the next "Sync Gmail" click.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";
import { buildRawMessage, base64UrlEncode, validateAttachments, sanitizeHeaderValue } from "../_shared/mime.ts";
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Who is calling? Nothing else happens until this passes.
    const authz = await authorizeTeamRequest(req, supabase);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: authz.error, message: authz.message }), { status: authz.status, headers: corsHeaders });
    }
    console.log(`send-gmail-message called by ${authz.role} ${authz.userId}`);

    const {
      to: rawTo, cc: rawCc, bcc: rawBcc, subject: rawSubject, body, bodyHtml: rawBodyHtml, threadId, replyToMessageId,
      attachments: rawAttachments,
      linked_client_id, linked_resource_id, linked_task_id, linked_event_id, linked_request_id
    } = await req.json();

    // No line breaks or control characters in header values.
    const to = sanitizeHeaderValue(rawTo);
    const cc = sanitizeHeaderValue(rawCc);
    const bcc = sanitizeHeaderValue(rawBcc);
    // HTML body from the app's formatting editor (already sanitized there).
    // Script/style/event handlers are stripped again here as a backstop.
    const bodyHtml = rawBodyHtml
      ? String(rawBodyHtml)
          .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
          .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
          .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=$2#$2")
          .slice(0, 400000)
      : null;
    const subject = sanitizeHeaderValue(rawSubject);

    if (!to || !subject || !body) {
      return new Response(JSON.stringify({ error: "to, subject, and body are required" }), { status: 400, headers: corsHeaders });
    }

    const checked = validateAttachments(rawAttachments);
    if ("error" in checked) {
      return new Response(JSON.stringify({ error: "invalid_attachments", message: checked.error }), { status: 400, headers: corsHeaders });
    }
    const attachments = checked.attachments;

    const accessToken = await getFreshGoogleAccessToken(supabase);

    const { data: tokenRow } = await supabase
      .from("google_auth_tokens")
      .select("email")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    const fromAddress = tokenRow?.email || "team@sphynxautomation.com";

    let inReplyToHeader: string | null = null;
    let referencesHeader: string | null = null;

    if (replyToMessageId) {
      const metaRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(String(replyToMessageId))}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (metaRes.status === 401) throw new GoogleAuthError("Google rejected the token while looking up the original message.");
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const headers = meta.payload?.headers || [];
        const msgIdHeader = headers.find((h: any) => h.name === "Message-ID")?.value;
        const refsHeader = headers.find((h: any) => h.name === "References")?.value;
        if (msgIdHeader) {
          inReplyToHeader = msgIdHeader;
          referencesHeader = refsHeader ? `${refsHeader} ${msgIdHeader}` : msgIdHeader;
        }
      } else {
        console.error("Could not fetch original message headers for threading:", await metaRes.text());
        // Not fatal -- send proceeds as a non-threaded message below.
      }
    }

    const rawMessage = buildRawMessage({
      from: fromAddress,
      to,
      cc: cc || null,
      bcc: bcc || null,
      subject,
      body,
      html: bodyHtml,
      inReplyTo: inReplyToHeader,
      references: referencesHeader,
      attachments,
    });
    const raw = base64UrlEncode(rawMessage);

    const sendPayload: any = { raw };
    if (threadId) sendPayload.threadId = threadId;

    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(sendPayload)
    });

    if (sendRes.status === 401) throw new GoogleAuthError("Google rejected the token while sending.");
    if (sendRes.status === 403) {
      const detail = await sendRes.text();
      return new Response(JSON.stringify({
        error: "insufficient_scope",
        message: "Gmail refused this — most likely the connected account doesn't have send permission yet. Reconnect (Connect Google Account) to grant it.",
        detail
      }), { status: 403, headers: corsHeaders });
    }
    if (!sendRes.ok) {
      const detail = await sendRes.text();
      return new Response(JSON.stringify({ error: "gmail_send_failed", message: detail }), { status: 502, headers: corsHeaders });
    }

    const sent = await sendRes.json(); // { id, threadId, labelIds }

    const toEmails = String(to).split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean);
    const ccEmails = cc ? String(cc).split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean) : [];
    const { error: insertErr } = await supabase.from("gmail_messages").upsert({
      id: sent.id,
      thread_id: sent.threadId || threadId || null,
      sender: fromAddress,
      recipient_to: to,
      recipient_cc: cc || null,
      recipient_bcc: null,
      subject,
      snippet: body.slice(0, 200),
      body,
      body_html: bodyHtml,
      date: new Date().toISOString(),
      participants: [fromAddress.toLowerCase(), ...toEmails, ...ccEmails],
      linked_client_id: linked_client_id || null,
      linked_resource_id: linked_resource_id || null,
      linked_task_id: linked_task_id || null,
      linked_event_id: linked_event_id || null,
      ...(linked_request_id ? { linked_request_id } : {}),
      sent_via_app: true
    }, { onConflict: "id", ignoreDuplicates: false });

    if (insertErr) {
      // Not fatal -- the email genuinely sent. The next "Sync Gmail" run
      // will pick it up via the normal in:sent path regardless.
      console.error("Sent successfully but failed to save local copy:", insertErr.message);
    }

    return new Response(JSON.stringify({ success: true, id: sent.id, threadId: sent.threadId, attachments: attachments.length }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    const isAuthErr = err instanceof GoogleAuthError;
    console.error(isAuthErr ? "Google Auth Error:" : "Send Gmail Error:", err.message);
    return new Response(
      JSON.stringify({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }),
      { status: isAuthErr ? 401 : 500, headers: corsHeaders }
    );
  }
});
