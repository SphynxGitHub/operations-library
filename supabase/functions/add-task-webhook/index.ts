// ================================================================================================
// FUNCTION: add-task-webhook
//
// WHAT IT DOES:   Adds a task to a client's project from another system, using the
//                 same task shape and defaults the app uses.
//
// CALLED BY:      Zapier, Make or a form tool.
//
// WHO CAN CALL:   Another system (Zapier, Make or Zoom) sending the header
//                 x-webhook-secret. Enforcement is switched on with
//                 WEBHOOK_ENFORCE=true; until then a call without it still works and
//                 is written to the log as UNAUTHENTICATED.
//
// READS/CHANGES:  Reads workspace_clients, then rewrites that client's whole
//                 project_data with the new task added.
//
// NEEDS:          _shared/webhook-auth.ts. The WEBHOOK_SECRET function secret, and
//                 later WEBHOOK_ENFORCE=true.
//
// CHANGED FROM THE ORIGINAL: Added the shared-secret check, and corrected the old
//                            'Auth: none' note.
// ================================================================================================

// POST /functions/v1/add-task-webhook
//
// Adds a task/deliverable to a client's workspace from an external system
// (Zapier, Make, a form tool, etc.). Mirrors the same task shape and
// defaulting rules the app itself uses when creating tasks — see
// features/tasks.js (OL.saveClientCreateTask) and features/business/tasks.js
// (OL.getSystemStatuses) for the in-app equivalents.
//
// Auth: send the header  x-webhook-secret: <your WEBHOOK_SECRET>  (see _shared/webhook-auth.ts).
// Still deploy with `--no-verify-jwt`, since Zapier/Make/Zoom do not send a Supabase login.
//   supabase functions deploy add-task-webhook --no-verify-jwt
//
// Example payload:
// {
//   "clientId": "abc123",              // preferred — exact project id
//   "clientName": "Wealth Innovation",  // fallback — fuzzy name match
//   "title": "Send onboarding packet",
//   "description": "Optional longer description",
//   "assignee": "Sphynx Task",          // optional — defaults based on client type
//   "status": "Pending Sphynx Action",  // optional — defaults based on client type
//   "dueDate": "2026-10-01"             // optional
// }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkWebhookSecret } from "../_shared/webhook-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

function generateTaskId() {
  return "tsk_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), { status: 405, headers: corsHeaders });
  }

  try {
    // Who is calling? Other systems prove themselves with the x-webhook-secret header (see _shared/webhook-auth.ts).
    const hook = checkWebhookSecret(req, { secret: Deno.env.get("WEBHOOK_SECRET"), enforce: Deno.env.get("WEBHOOK_ENFORCE") }, "add-task-webhook");
    if (!hook.ok) {
      return new Response(JSON.stringify({ error: hook.error, message: hook.message }), { status: hook.status, headers: corsHeaders });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Body must be valid JSON" }), { status: 400, headers: corsHeaders });
    }

    const {
      clientId,
      clientName,
      title,
      description = "",
      assignee,
      status,
      dueDate = ""
    } = body || {};

    if (!title || typeof title !== "string" || !title.trim()) {
      return new Response(JSON.stringify({ error: "`title` is required and must be a non-empty string." }), { status: 400, headers: corsHeaders });
    }
    if (!clientId && !clientName) {
      return new Response(JSON.stringify({ error: "Provide either `clientId` or `clientName` to identify the project." }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve the target client row. Prefer clientId (exact) when given;
    // fall back to a case-insensitive name match.
    let query = supabase.from("workspace_clients").select("id, meta, project_data");
    query = clientId ? query.eq("id", clientId) : query.ilike("meta->>name", clientName);
    const { data: rows, error: fetchErr } = await query;

    if (fetchErr) return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers: corsHeaders });
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ error: "No client matched clientId/clientName." }), { status: 404, headers: corsHeaders });
    }
    if (rows.length > 1) {
      return new Response(JSON.stringify({
        error: "clientName matched more than one client — use clientId instead.",
        matches: rows.map((r: any) => ({ id: r.id, name: r.meta?.name }))
      }), { status: 409, headers: corsHeaders });
    }

    const client = rows[0];
    const projectData = client.project_data || {};
    if (!Array.isArray(projectData.clientTasks)) projectData.clientTasks = [];

    // Same partner-vs-Sphynx-client defaulting the app itself applies (see
    // features/tasks.js) — a client owned by a partner gets the generic
    // Pending/In Process/Complete pipeline and "Team Task" default, a direct
    // Sphynx client gets the Sphynx pipeline and "Sphynx Task" default.
    const isPartnerClient = !!client.meta?.partnerOwner;
    const resolvedAssignee = assignee || (isPartnerClient ? "Team Task" : "Sphynx Task");
    const resolvedStatus = status || (isPartnerClient ? "Pending" : "Pending Sphynx Action");

    const newTask = {
      id: generateTaskId(),
      title: title.trim(),
      name: title.trim(),
      description,
      status: resolvedStatus,
      assignee: resolvedAssignee,
      dueDate,
      isClientTask: resolvedAssignee !== "Sphynx Task" && resolvedAssignee !== "Team Task",
      loggedHours: 0,
      createdAt: new Date().toISOString(),
      createdBy: "webhook"
    };

    projectData.clientTasks.unshift(newTask);

    const { error: updateErr } = await supabase
      .from("workspace_clients")
      .update({ project_data: projectData })
      .eq("id", client.id);

    if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: corsHeaders });

    return new Response(JSON.stringify({ status: "created", clientId: client.id, task: newTask }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    console.error("add-task-webhook failed:", err.message);
    return new Response(JSON.stringify({ error: "server_error", message: err.message }), { status: 500, headers: corsHeaders });
  }
});
