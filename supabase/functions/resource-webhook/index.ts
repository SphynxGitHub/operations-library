import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

// Meant to be called from a meta-Zap: Zapier Manager "New Zap" trigger ->
// Webhooks by Zapier -> POST here. Creates a bare resource shell (name +
// External Link) in the matching project so error auto-matching works
// immediately, even for Zaps you haven't touched in this app yet. Fill in
// the resource's Steps by hand afterward from the resource editor.
//
// Client matching: same priority as error-webhook — client_id (exact),
// client_email (Team tab match), client_name (fuzzy). No sheet_id here
// since that's an error-log-specific legacy field.
//
// Example payload:
// {
//   "client_id": "abc123",
//   "name": "RingCentral -> Wealthbox: Voicemail Transcript Note",
//   "external_url": "https://zapier.com/editor/231798906",
//   "root_id": "231798906"                 // used to build external_url if you don't have the direct link
// }
//
// IMPORTANT — a residual risk worth knowing about: resources live inside
// each client's single project_data JSON blob, which the app's own browser
// tab also owns and re-saves on its own timer. If you (or anyone) has that
// client's project open in the app at the exact moment this webhook fires,
// the browser's next autosave can overwrite what this webhook just wrote,
// silently dropping the new resource. Low-probability in practice, but not
// zero — if a shell seems to go missing, that's the likely cause.
function pick(body: any, ...keys: string[]) {
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== "") return body[k];
  }
  return null;
}

function uid(): string {
  return "id_" + Math.random().toString(36).slice(2, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const name = pick(body, "name", "Name", "title", "Title");
    if (!name) {
      return new Response(JSON.stringify({ error: "Missing required field: name" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const explicitClientId = pick(body, "client_id", "clientId", "project_id", "projectId");
    const clientEmail = pick(body, "client_email", "clientEmail", "email");
    const clientName = pick(body, "client_name", "clientName", "client");
    const rootId = pick(body, "root_id", "rootId", "Root ID");
    const externalUrl = pick(body, "external_url", "externalUrl", "zap_link", "Zap Link")
      || (rootId ? `https://zapier.com/editor/${rootId}` : null);

    let clientId: string | null = null;

    if (explicitClientId) {
      const { data } = await supabase.from("workspace_clients").select("id").eq("id", explicitClientId).maybeSingle();
      if (data) clientId = data.id;
    }
    if (!clientId && clientEmail) {
      const target = String(clientEmail).trim().toLowerCase();
      const { data } = await supabase.from("workspace_clients").select("id, project_data");
      const match = (data || []).find((c: any) =>
        (c.project_data?.teamMembers || []).some((m: any) => (m?.email || "").trim().toLowerCase() === target)
      );
      if (match) clientId = match.id;
    }
    if (!clientId && clientName) {
      const { data } = await supabase.from("workspace_clients").select("id, meta");
      const match = (data || []).find((c: any) =>
        (c.meta?.name || "").toLowerCase().includes(String(clientName).toLowerCase()) ||
        String(clientName).toLowerCase().includes((c.meta?.name || "").toLowerCase())
      );
      if (match) clientId = match.id;
    }

    if (!clientId) {
      return new Response(JSON.stringify({ error: "no_client_match", message: "Couldn't match this to a project — pass client_id, client_email, or client_name." }), { status: 200, headers: corsHeaders });
    }

    const { data: clientRow, error: fetchError } = await supabase.from("workspace_clients").select("project_data").eq("id", clientId).single();
    if (fetchError) throw new Error(fetchError.message);

    const projectData = clientRow.project_data || {};
    const resources = projectData.localResources || [];

    // Don't create a duplicate if a resource with this exact External Link already exists.
    if (externalUrl) {
      const existing = resources.find((r: any) => r.externalUrl && r.externalUrl === externalUrl);
      if (existing) {
        return new Response(JSON.stringify({ success: true, alreadyExisted: true, resourceId: existing.id, matchedClientId: clientId }), { status: 200, headers: corsHeaders });
      }
    }

    const newResource = {
      id: uid(),
      name,
      type: "Zap",
      archetype: "Multi-Step",
      category: "Flows",
      visible: true,
      steps: [],
      externalUrl: externalUrl || undefined
    };

    resources.push(newResource);
    projectData.localResources = resources;

    const { error: updateError } = await supabase.from("workspace_clients").update({ project_data: projectData }).eq("id", clientId);
    if (updateError) throw new Error(updateError.message);

    return new Response(JSON.stringify({ success: true, resourceId: newResource.id, matchedClientId: clientId }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    console.error("Resource webhook failed:", err.message);
    return new Response(JSON.stringify({ error: "server_error", message: err.message }), { status: 500, headers: corsHeaders });
  }
});
