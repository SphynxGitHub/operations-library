// ================================================================================================
// FUNCTION: integration-import
//
// WHAT IT DOES:   Pulls workflow copies (and similar lists) from a client's outside system, using the
//                 API key kept in secure storage. It replaces the old Firebase proxies: the app no
//                 longer holds the key or sends it in a web address. Supported: Wealthbox, Jotform,
//                 Calendly, ActiveCampaign, MailerLite, YouCanBookMe, Redtail, Process Street. Each
//                 returns the same shape the app already reads.
//
// CALLED BY:      The Import Hub and the sync buttons in a client project.
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member. Anyone else gets 401 or 403.
//
// READS/CHANGES:  Reads the key from Vault (cred:<client id>:<access entry id>). Makes read-only calls
//                 to the named service. Changes nothing.
//
// NEEDS:          _shared/auth.ts, _shared/integrations.ts and the database functions from 010_secret_vault.sql.
//
// CHANGED FROM THE ORIGINAL: New function, replacing the Firebase proxies. Every address it calls is
//                 fixed or checked, so it cannot be pointed at anything else.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { runImport, SERVICES, UpstreamError, BadRequest, redact, type Service } from "../_shared/integrations.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

const ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let key = "";
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const authz = await authorizeTeamRequest(req, supabase);
    if (!authz.ok) return json({ error: authz.error, message: authz.message }, authz.status);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "bad_request", message: "Body must be valid JSON." }, 400); }

    const service = String(body?.service || "") as Service;
    const clientId = String(body?.clientId || "");
    const entryId = String(body?.entryId || "");
    if (!SERVICES.includes(service)) return json({ error: "bad_request", message: `service must be one of: ${SERVICES.join(", ")}.` }, 400);
    if (!ID_RE.test(clientId) || !ID_RE.test(entryId)) return json({ error: "bad_request", message: "clientId and entryId are required." }, 400);

    const { data: stored, error: getErr } = await supabase.rpc("ol_secret_get", { p_name: `cred:${clientId}:${entryId}` });
    if (getErr) { console.error("integration-import could not read the key:", getErr.message); return json({ error: "server_error", message: "Could not read the stored key." }, 500); }
    if (!stored) return json({ error: "no_key", message: "No key is stored for this entry yet. Add it in the client's credentials." }, 404);
    key = String(stored);

    console.log(`integration-import: ${authz.role} ${authz.userId} ran ${service} for ${clientId}`);
    const result = await runImport(service, key, { baseUrl: body?.baseUrl, page: Number(body?.page) || undefined, email: body?.email }, fetch);
    return json(result);

  } catch (err: any) {
    if (err instanceof BadRequest) return json({ error: "bad_request", message: err.message }, 400);
    if (err instanceof UpstreamError) {
      const rejected = err.status === 401 || err.status === 403;
      return json({
        error: rejected ? "upstream_rejected" : "upstream_error",
        upstreamStatus: err.status,
        message: rejected ? "The service rejected the stored key. It may have been revoked or replaced; enter the new key." : redact(err.message, key),
      }, 502);
    }
    console.error("integration-import failed:", redact(String(err?.message || err), key));
    return json({ error: "server_error", message: "Something went wrong." }, 500);
  }
});
