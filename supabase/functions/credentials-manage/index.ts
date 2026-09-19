// ================================================================================================
// FUNCTION: credentials-manage
//
// WHAT IT DOES:   Keeps a client's API key in secure storage (Supabase Vault) instead of inside the
//                 client project. It can store or replace a key, remove it, or say whether one is
//                 stored. It NEVER sends a key back: the app can put a key in and ask "is there
//                 one?", but cannot read it out.
//
// CALLED BY:      The credentials section of a client project (the field where the key is pasted),
//                 and the "move stored keys to secure storage" button.
//
// WHO CAN CALL:   A signed-in Sphynx admin or team member. Anyone else gets 401 or 403.
//
// READS/CHANGES:  Vault, through the database functions ol_secret_put / ol_secret_get /
//                 ol_secret_delete, under the name  cred:<client id>:<access entry id>.
//                 Reads workspace_clients only to check the client exists.
//
// NEEDS:          _shared/auth.ts, _shared/integrations.ts (for redact) and the database functions from 010_secret_vault.sql.
//
// CHANGED FROM THE ORIGINAL: New function.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { redact } from "../_shared/integrations.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

const ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const MAX_SECRET = 8000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const authz = await authorizeTeamRequest(req, supabase);
    if (!authz.ok) return json({ error: authz.error, message: authz.message }, authz.status);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "bad_request", message: "Body must be valid JSON." }, 400); }

    const action = String(body?.action || "");
    const clientId = String(body?.clientId || "");
    const entryId = String(body?.entryId || "");
    if (!["save", "clear", "has"].includes(action)) return json({ error: "bad_request", message: "action must be save, clear or has." }, 400);
    if (!ID_RE.test(clientId) || !ID_RE.test(entryId)) return json({ error: "bad_request", message: "clientId and entryId are required." }, 400);

    // "_master" is the master registry (keys not tied to one client project). Anything else must be a real project.
    if (clientId !== "_master") {
      const { data: client } = await supabase.from("workspace_clients").select("id").eq("id", clientId).maybeSingle();
      if (!client) return json({ error: "not_found", message: "No such client project." }, 404);
    }

    const name = `cred:${clientId}:${entryId}`;

    if (action === "save") {
      const secret = String(body?.secret ?? "").trim();
      if (!secret) return json({ error: "bad_request", message: "The key is empty." }, 400);
      if (secret.length > MAX_SECRET) return json({ error: "bad_request", message: "The key is too long." }, 400);
      const { error } = await supabase.rpc("ol_secret_put", { p_name: name, p_secret: secret, p_description: `${clientId} / ${entryId}` });
      if (error) { console.error("credentials-manage save failed:", redact(error.message, secret)); return json({ error: "server_error", message: "Could not store the key." }, 500); }
      console.log(`credentials-manage: ${authz.role} ${authz.userId} stored a key for ${name}`);
      // a short hint so the app can show which key is stored; nothing for short values
      return json({ ok: true, hint: secret.length >= 12 ? secret.slice(-4) : "" });
    }

    if (action === "clear") {
      const { data, error } = await supabase.rpc("ol_secret_delete", { p_name: name });
      if (error) { console.error("credentials-manage clear failed:", error.message); return json({ error: "server_error", message: "Could not remove the key." }, 500); }
      console.log(`credentials-manage: ${authz.role} ${authz.userId} removed the key for ${name}`);
      return json({ ok: true, removed: !!data });
    }

    const { data, error } = await supabase.rpc("ol_secret_get", { p_name: name });
    if (error) { console.error("credentials-manage has failed:", error.message); return json({ error: "server_error", message: "Could not check." }, 500); }
    return json({ ok: true, has: !!data });   // whether one is stored; never the key itself

  } catch (err: any) {
    console.error("credentials-manage failed:", err.message);
    return json({ error: "server_error", message: "Something went wrong." }, 500);
  }
});
