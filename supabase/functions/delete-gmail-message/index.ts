// ================================================================================================
// FUNCTION: delete-gmail-message
//
// WHAT IT DOES:   Moves one email to Trash in the real Gmail account. It is not a
//                 permanent delete: Gmail keeps it for 30 days. The app removes its
//                 own copy separately.
//
// CALLED BY:      The Delete button on an email in Communications.
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member (the app sends the login
//                 token). Anyone else gets 401 or 403 and nothing happens.
//
// READS/CHANGES:  Gmail only: moves the message to Trash. Does not touch the database.
//
// NEEDS:          _shared/google-token.ts (the stored Google connection),
//                 _shared/auth.ts, _shared/gmail-errors.ts. Needs Google's
//                 gmail.modify permission, so the Google account must be reconnected
//                 after that permission was added.
//
// CHANGED FROM THE ORIGINAL: Added the login check, message id check, a clear
//                            'insufficient_scope' answer when Google permission is
//                            missing, and treating an already-missing message as done.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { isInsufficientScope, INSUFFICIENT_SCOPE_MESSAGE } from "../_shared/gmail-errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

// Auth: Authorization: Bearer <the caller's Supabase login token>. The caller must be an admin or a
// Sphynx team member (see ../_shared/auth.ts). Anyone else gets 401 or 403 and nothing is touched.
//
// Moves the message to Trash in real Gmail (recoverable there for 30
// days) rather than permanent delete — the in-app confirm() before this
// fires doesn't warn about permanence beyond "delete", so Trash is the
// safer match. The gmail_messages row itself is deleted client-side,
// same as every other Supabase write in this app.
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

    const { id, threadId } = await req.json();
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing message id" }), { status: 400, headers: corsHeaders });
    }
    // Gmail message ids are plain letters and numbers. Anything else could change which Gmail API
    // path this call reaches once the id is placed in the URL, so it is refused.
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(id))) {
      return new Response(JSON.stringify({ error: "Invalid message id" }), { status: 400, headers: corsHeaders });
    }
    // Message-level ONLY: acting on one email must never change the other
    // messages in its conversation. (threadId is accepted but ignored.)
    const useThread = false && !!threadId;
    const target = useThread ? `threads/${threadId}` : `messages/${id}`;
    console.log(`delete-gmail-message called by ${authz.role} ${authz.userId}`);

    const accessToken = await getFreshGoogleAccessToken(supabase);

    const trashRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${target}/trash`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (trashRes.status === 401) {
      return new Response(
        JSON.stringify({ error: "reauth_required", message: "Google rejected the refreshed token. Please reconnect the account." }),
        { status: 401, headers: corsHeaders }
      );
    }
    if (!trashRes.ok) {
      const errText = await trashRes.text();
      // Moving mail to Trash needs the gmail.modify permission, which older connections do not have.
      if (trashRes.status === 403 && isInsufficientScope(errText)) {
        return new Response(JSON.stringify({ error: "insufficient_scope", message: INSUFFICIENT_SCOPE_MESSAGE }), { status: 403, headers: corsHeaders });
      }
      // Already gone from Gmail: nothing left to do.
      if (trashRes.status === 404) {
        return new Response(JSON.stringify({ success: true, alreadyGone: true }), { status: 200, headers: corsHeaders });
      }
      throw new Error(`Gmail trash failed: ${errText}`);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    const isAuthErr = err instanceof GoogleAuthError;
    console.error(isAuthErr ? "Delete Auth Error:" : "Delete Error:", err.message);
    return new Response(
      JSON.stringify({ error: isAuthErr ? "reauth_required" : "server_error", message: err.message }),
      { status: isAuthErr ? 401 : 500, headers: corsHeaders }
    );
  }
});
