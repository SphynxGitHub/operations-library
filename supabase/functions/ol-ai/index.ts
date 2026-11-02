// supabase/functions/ol-ai/index.ts
//
// The one place the app's AI features run. The browser sends { task, payload, mode, ctx }; this function
//   1. checks the caller is signed in as an admin or Sphynx team member,
//   2. removes passwords and keys from every piece of text (rules, not AI) BEFORE the AI sees anything,
//   3. runs the task's prompt on Claude and checks the answer's shape,
//   4. logs the run (cleaned) to ai_runs, and returns the result.
// A suggestion is only ever a suggestion: this function never changes client work.
//
// Needs the ANTHROPIC_API_KEY secret (already used by classify-email-candidates).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { scrubSecrets } from "../_shared/secret-scrub.ts";

const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("OL_AI_MODEL") || "claude-sonnet-4-6";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };

const JSON_ONLY = "Respond with ONLY valid JSON, no other text and no markdown fences. Quote text exactly as written in the source; never paraphrase a quote.";

const TASKS: Record<string, { feature: string; maxTokens: number; system: string }> = {
  recap_match: { feature: "recap", maxTokens: 1500, system:
`You match meeting recap entries for an automation agency to the client's existing items. Each entry has an id and text. For each entry choose the best target from ITEMS (copy its id and label exactly) or none.
Output {"matches":[{"entryId":string,"targetId":string|null,"targetLabel":string|null,"type":"change"|"approval"|"new_request"|"note","restates":boolean,"confidence":"low"|"medium"|"high"}]}. restates is true when the entry only repeats something already recorded on that item. ${JSON_ONLY}` },
  recap_from_summary: { feature: "recap", maxTokens: 2000, system:
`You read a Zoom AI meeting summary for an automation agency and pull out what the CLIENT said about their work: a new request, a change to something already built, an approval, or a question about existing work. Ignore scheduling, small talk, and our own internal to-dos. For each, copy the exact sentence or phrase from the SUMMARY as "quote" (verbatim), then match it to the best target from ITEMS (id and label copied exactly) or none. The summary may attribute statements to people by name; only include things asked or approved by the client side.
Output {"matches":[{"quote":string,"type":"change"|"approval"|"new_request"|"note","targetId":string|null,"targetLabel":string|null,"restates":boolean,"confidence":"low"|"medium"|"high"}]}. restates is true when it only repeats something already recorded on that item. Empty array if nothing qualifies. ${JSON_ONLY}` },
  email_classify: { feature: "email", maxTokens: 1500, system:
`You read the NEW text of one client email (earlier quoted messages are already removed) for an automation agency. Label each passage that is a request, change, approval, question, or information about existing work; ignore thanks and pleasantries. Compare with ITEMS and previously FLAGGED excerpts: if a passage restates something already there, say which.
Output {"suggestions":[{"quote":string,"kind":"request"|"change"|"approval"|"question"|"info","suggestedType":"new_request"|"change"|"approval"|"note","targetId":string|null,"targetLabel":string|null,"restatesFlagged":boolean,"confidence":"low"|"medium"|"high"}]}. Empty array if nothing qualifies. ${JSON_ONLY}` },
  email_review_sent: { feature: "email_review", maxTokens: 600, system:
`You read an email our team SENT to a client. Decide whether it asks the client to review or approve finished work. If so, list which of the closed ITEMS it covers (ids copied exactly).
Output {"isReviewRequest":boolean,"itemIds":[string],"quote":string,"confidence":"low"|"medium"|"high"}. ${JSON_ONLY}` },
  holding_reply: { feature: "holding_reply", maxTokens: 400, system:
`A client replied that they need more time to provide something. If the reply states or implies a date they will deliver by, give it. TODAY is given.
Output {"isHoldingReply":boolean,"statedDate":"YYYY-MM-DD"|null,"quote":string,"confidence":"low"|"medium"|"high"}. Never invent a date that is not stated or clearly implied (for example "Friday" means the next Friday from TODAY). ${JSON_ONLY}` },
  test_scenarios: { feature: "test_scenarios", maxTokens: 4000, system:
`You write test scenarios for an automation (Zapier, forms, integrations) built by an agency. From the SCOPE and BUILD DETAILS, write scenarios in three kinds: "path" (every expected branch), "edge" (missing fields, duplicates, multiple matches, tasks created days earlier), "unexpected" (a misspelled name, a category added without telling us, an unknown contact, a malformed line). Each has short steps, small realistic sampleData (fake names such as Amy Test with a plus-addressed email), and SEPARATE expected results, each one thing that can pass or fail. Mark clientVisible true only for plain-language expected paths a client can check.
Output {"scenarios":[{"title":string,"kind":"path"|"edge"|"unexpected","steps":[string],"sampleData":{string:string},"expected":[string],"clientVisible":boolean}]}. ${JSON_ONLY}` },
  suggested_asks: { feature: "suggested_asks", maxTokens: 2500, system:
`You list what an automation agency is likely to need from a client. Use the BLUEPRINTS (what each kind of resource usually needs before, during and after), SIMILAR PROJECTS (what was asked, and what turned out to be missing later: weight those higher), and what has ALREADY BEEN ASKED (do not repeat it). STAGE says whether this is before scoping, after scoping, or when a round is approved.
Output {"asks":[{"label":string,"why":string,"resource":string,"stage":"before_scoping"|"after_scoping"|"before_work","fromMissingLater":boolean}]}. Plain language a client understands. ${JSON_ONLY}` },
  lead_intent: { feature: "lead_intent", maxTokens: 400, system:
`You read an email from a prospective client. Decide what they want: "quote" (wants a price or proposal), "paid_scoping" (open to or asking for paid discovery or scoping), "intro_call" (wants a first conversation), or "unclear". Give the exact quote that shows it. Use "unclear" when not sure.
Output {"intent":"quote"|"paid_scoping"|"intro_call"|"unclear","quote":string,"confidence":"low"|"medium"|"high"}. ${JSON_ONLY}` },
  howto_guide: { feature: "howto", maxTokens: 4000, system:
`You write a how-to guide for a client from the SCOPE and BUILD DETAILS of what was built. Sections: What was built; How to use it day to day; How to add or change things safely (include any naming rules the automations depend on); Who to contact. Plain language, short, no jargon. If TEAM_SIZE is more than 1, also write an onboarding template and an offboarding template for the new systems (steps for adding and removing a person).
Output {"guide":{"built":string,"daily":string,"safeChanges":string,"contact":string},"onboarding":[string]|null,"offboarding":[string]|null}. ${JSON_ONLY}` },
  ask_notes: { feature: "ask_notes", maxTokens: 900, system:
`You answer a question about an agency's client work using ONLY the NOTES provided (each has an id, date, and text). If the notes do not answer it, say so. Do not use outside knowledge about the client.
Output {"answer":string,"citations":[noteId],"found":boolean}. Cite every note the answer relies on, using ids copied exactly. ${JSON_ONLY}` },
  history_entry: { feature: "history", maxTokens: 500, system:
`You write one history entry for a resource (a form, automation or email) when a task on it closes. From the TASK and its COMMENTS write 1 to 3 plain sentences: what changed and why. Do not include anything not in the source.
Output {"entry":string,"confidence":"low"|"medium"|"high"}. ${JSON_ONLY}` },
};

// Removes secrets from every string inside the payload. Returns the cleaned copy and how many places were replaced.
function scrubDeep(v: any, count: { n: number }, depth = 0): any {
  if (depth > 6) return null;
  if (typeof v === "string") { const r = scrubSecrets(v.slice(0, 12000)); count.n += r.removed; return r.text; }
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => scrubDeep(x, count, depth + 1));
  if (v && typeof v === "object") { const o: any = {}; Object.keys(v).slice(0, 60).forEach((k) => { o[k] = scrubDeep(v[k], count, depth + 1); }); return o; }
  return v;
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!API_KEY) return reply({ error: "ANTHROPIC_API_KEY is not set on this project" }, 500);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const authz = await authorizeTeamRequest(req, service);
  if (!authz.ok) return reply({ error: authz.error, message: authz.message }, authz.status);

  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "Send JSON" }, 400); }
  const task = TASKS[String(body?.task || "")];
  if (!task) return reply({ error: "Unknown task" }, 400);
  const mode = body?.mode === "shadow" ? "shadow" : "suggest";
  const ctx = body?.ctx && typeof body.ctx === "object" ? body.ctx : {};

  const count = { n: 0 };
  const clean = scrubDeep(body?.payload ?? {}, count);
  const runId = "air_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const log = async (output: unknown, error: string | null) => {
    try {
      await service.from("ai_runs").insert({ id: runId, feature: task.feature, mode, client_id: ctx.clientId ? String(ctx.clientId) : null,
        source_kind: ctx.sourceKind ? String(ctx.sourceKind) : null, source_id: ctx.sourceId ? String(ctx.sourceId) : null,
        output: output ?? null, secrets_removed: count.n, error, created_by: authz.userId });
    } catch (_e) { /* logging must never block the answer */ }
  };

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: task.maxTokens, system: task.system,
        messages: [{ role: "user", content: JSON.stringify(clean) }] }),
    });
    if (!resp.ok) { const t = await resp.text(); await log(null, `Anthropic ${resp.status}`); return reply({ error: `Anthropic API error: ${t.slice(0, 300)}` }, 502); }
    const data = await resp.json();
    const raw = (data.content || []).map((b: any) => b.text || "").join("").trim().replace(/^```json\s*|```\s*$/g, "").trim();
    let result: any = null;
    try { result = JSON.parse(raw); } catch { await log(null, "Answer was not JSON"); return reply({ error: "The AI answer could not be read", runId, secretsRemoved: count.n }, 502); }
    await log(result, null);
    return reply({ result, runId, secretsRemoved: count.n });
  } catch (e) {
    await log(null, String(e).slice(0, 300));
    return reply({ error: String(e) }, 500);
  }
});
