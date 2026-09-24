// ================================================================================================
// FUNCTION: archive-gmail-message
//
// WHAT IT DOES:   Archives one email in the real Gmail account by removing its Inbox
//                 label, and marks the stored copy as archived in Gmail.
//
// CALLED BY:      The Archive button on an email in Communications.
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member (the app sends the login
//                 token). Anyone else gets 401 or 403 and nothing happens.
//
// READS/CHANGES:  Gmail: removes the INBOX label. Database: sets archived_in_gmail =
//                 true on the gmail_messages row.
//
// MODES:          mode "message" (default): removes INBOX from this one message only.
//                 mode "thread_if_latest" (the Archive button): looks at the whole
//                 conversation in Gmail. If this email is the most recent message in it
//                 (drafts, trash and spam ignored), the WHOLE thread is archived in Gmail.
//                 If a newer message exists, Gmail is left untouched and the response
//                 says { skipped: "not_latest" } — the email is archived in the app only.
//
// NEEDS:          _shared/google-token.ts (the stored Google connection),
//                 _shared/auth.ts, _shared/gmail-errors.ts. Needs Google's
//                 gmail.modify permission (reconnect Google after it was added).
//
// CHANGED FROM THE ORIGINAL: Added the login check, message id check, a clear
//                            'insufficient_scope' answer when Google permission is
//                            missing, and treating an already-missing message as done.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { isInsufficientScope, INSUFFICIENT_SCOPE_MESSAGE } from "../_shared/gmail-errors.ts";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

// Auth: a signed-in Sphynx admin or team member (Authorization: Bearer <login token>), see
// ../_shared/auth.ts. Anyone else gets 401 or 403 and nothing happens.
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

    const { id, mode } = await req.json();
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing message id" }), { status: 400, headers: corsHeaders });
    }
    // Gmail message ids are plain letters and numbers. Anything else could change which Gmail API
    // path this call reaches once the id is placed in the URL, so it is refused.
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(id))) {
      return new Response(JSON.stringify({ error: "Invalid message id" }), { status: 400, headers: corsHeaders });
    }
    const accessToken = await getFreshGoogleAccessToken(supabase);
    const gmailHeaders = { Authorization: `Bearer ${accessToken}` };

    // Default is message-level: only this email loses its INBOX label.
    // "thread_if_latest": archive the whole conversation, but ONLY when this
    // email is the newest message in it. Gmail is the source of truth for
    // that, not the app's copy (the app may not have every message).
    let useThread = false;
    let threadId: string | null = null;
    if (mode === "thread_if_latest") {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=minimal`, { headers: gmailHeaders });
      if (msgRes.status === 401) {
        return new Response(JSON.stringify({ error: "reauth_required", message: "Google rejected the refreshed token. Please reconnect the account." }), { status: 401, headers: corsHeaders });
      }
      if (msgRes.status === 404) {
        return new Response(JSON.stringify({ success: true, alreadyGone: true }), { status: 200, headers: corsHeaders });
      }
      if (!msgRes.ok) throw new Error(`Gmail message lookup failed: ${await msgRes.text()}`);
      threadId = (await msgRes.json()).threadId || null;

      if (threadId) {
        const thrRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=minimal`, { headers: gmailHeaders });
        if (thrRes.status === 401) {
          return new Response(JSON.stringify({ error: "reauth_required", message: "Google rejected the refreshed token. Please reconnect the account." }), { status: 401, headers: corsHeaders });
        }
        if (!thrRes.ok) throw new Error(`Gmail thread lookup failed: ${await thrRes.text()}`);
        const thread = await thrRes.json();
        // Drafts, trashed and spam messages don't count as "a newer email".
        const real = (thread.messages || []).filter((m: any) => {
          const labels: string[] = m.labelIds || [];
          return !labels.includes("DRAFT") && !labels.includes("TRASH") && !labels.includes("SPAM");
        });
        const latest = real.reduce((a: any, b: any) =>
          (!a || Number(b.internalDate || 0) >= Number(a.internalDate || 0)) ? b : a, null);

        if (latest && latest.id !== id) {
          // A newer message exists: leave Gmail exactly as it is.
          return new Response(JSON.stringify({ success: true, skipped: "not_latest" }), { status: 200, headers: corsHeaders });
        }
        useThread = true;
      }
    }
    const target = useThread ? `threads/${threadId}` : `messages/${id}`;

    const modRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${target}/modify`, {
      method: "POST",
      headers: { ...gmailHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ removeLabelIds: ["INBOX"] })
    });

    if (modRes.status === 401) {
      return new Response(
        JSON.stringify({ error: "reauth_required", message: "Google rejected the refreshed token. Please reconnect the account." }),
        { status: 401, headers: corsHeaders }
      );
    }
    if (!modRes.ok) {
      const errText = await modRes.text();
      // Archiving needs the gmail.modify permission, which older connections do not have.
      if (modRes.status === 403 && isInsufficientScope(errText)) {
        return new Response(JSON.stringify({ error: "insufficient_scope", message: INSUFFICIENT_SCOPE_MESSAGE }), { status: 403, headers: corsHeaders });
      }
      // Already gone from Gmail: nothing left to do.
      if (modRes.status === 404) {
        return new Response(JSON.stringify({ success: true, alreadyGone: true }), { status: 200, headers: corsHeaders });
      }
      throw new Error(`Gmail modify failed: ${errText}`);
    }

    // Only this row is marked here. The Gmail -> app reconciliation in
    // get-gmail-messages also only archives a thread's most recent message,
    // so older messages in this thread stay unarchived in the app.
    await supabase.from("gmail_messages").update({ archived_in_gmail: true }).eq("id", id);

    return new Response(JSON.stringify({ success: true, scope: useThread ? "thread" : "message" }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    const isAuthErr = err instanceof GoogleAuthError;
    console.error(isAuthErr ? "Archive Auth Error:" : "Archive Error:", err.message);
    return new Response(
      JSON.stringify({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }),
      { status: isAuthErr ? 401 : 500, headers: corsHeaders }
    );
  }
});
