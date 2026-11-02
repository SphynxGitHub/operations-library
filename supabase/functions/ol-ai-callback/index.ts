// supabase/functions/ol-ai-callback/index.ts
//
// Where the Zap sends its answer. ol-ai starts an AI run, hands the Zap a run id and a signed token, and waits; the Zap
// POSTs { run_id, token, text } here when its AI step finishes. The token proves the answer belongs to a real pending run.
// Anything else is refused.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runToken } from "../_shared/hmac.ts";
import { safeEqual } from "../_shared/auth.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "Send JSON" }, 400); }
  const runId = String(body?.run_id || ""), token = String(body?.token || "");
  const text = typeof body?.text === "string" ? body.text : typeof body?.output === "string" ? body.output : "";
  if (!/^air_[a-z0-9]{8,40}$/.test(runId) || !token || !text) return reply({ error: "run_id, token and text are required" }, 400);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await runToken(runId, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!safeEqual(token, expected)) return reply({ error: "Not allowed" }, 403);

  // Only a run that is still waiting can receive an answer, and only once.
  const { data, error } = await service.from("ai_runs").update({ output: { _raw: text.slice(0, 60000) }, error: null })
    .eq("id", runId).eq("error", "pending").select("id");
  if (error) return reply({ error: "Could not save the answer" }, 500);
  if (!data || !data.length) return reply({ error: "That run is not waiting for an answer" }, 409);
  return reply({ ok: true });
});
