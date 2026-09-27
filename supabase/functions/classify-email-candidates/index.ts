// supabase/functions/classify-email-candidates/index.ts
//
// Stateless classification proxy: given an email body and a list of the
// client's currently open requests/resources/tasks (for existing-match
// context), asks Claude to identify candidate asks — new requests,
// revisions, or matches against something already open — and returns them
// as structured JSON. Does not read or write the database itself; the
// caller (features/business/communications.js's OL.classifyEmailCandidates)
// already has the open-items context in memory and writes the result back
// to gmail_messages.suggestions once it gets a response.
//
// Setup required before this works: add ANTHROPIC_API_KEY as a secret on
// this Supabase project (Project Settings -> Edge Functions -> Secrets, or
// `supabase secrets set ANTHROPIC_API_KEY=...`). The key never reaches the
// browser — only this function, running server-side, ever sees it.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You review one client email for an automation services agency and flag candidate asks — things the client wants built, changed, or is asking about an existing item.

For each candidate you find, output:
- "text": the exact sentence or phrase from the email (verbatim, not paraphrased)
- "suggestedType": "new_request" (something new, not on the open-items list) | "revision" (a change to something already built) | "existing_match" (this is about one of the OPEN ITEMS below — name which one)
- "matchTargetId" and "matchTargetLabel": only when suggestedType is "existing_match" — the id and label of the open item it matches, copied exactly from the list you're given
- "confidence": "low" | "medium" | "high" — how sure you are this is a real actionable ask, not scheduling chatter, a pleasantry, or something already fully resolved in the email itself

Skip scheduling questions, thank-yous, and anything that isn't actually asking for or referencing work. If nothing qualifies, return an empty array.

Respond with ONLY a JSON array, no other text, no markdown fences. Example:
[{"text":"could you also add a text reminder","suggestedType":"new_request","confidence":"medium"},{"text":"the confirmation email still has the old logo","suggestedType":"existing_match","matchTargetId":"res-42","matchTargetLabel":"Confirmation Email","confidence":"high"}]`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set on this project" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { emailBody, openItems } = await req.json();
    if (!emailBody || typeof emailBody !== "string") {
      return new Response(JSON.stringify({ error: "emailBody (string) is required" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // openItems: [{id, type: 'request'|'resource'|'task', label}], capped —
    // this goes straight into the prompt, so keep it to what's actually
    // relevant (the caller should already be scoping this to one client's
    // open items, not the whole database).
    const itemsList = (Array.isArray(openItems) ? openItems : []).slice(0, 60)
      .map((i: any) => `- [${i.type}] ${i.id}: ${i.label}`).join("\n") || "(none)";

    const userMessage = `OPEN ITEMS for this client:\n${itemsList}\n\nEMAIL BODY:\n${emailBody.slice(0, 8000)}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: `Anthropic API error: ${errText}` }), {
        status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const raw = (data.content || []).map((b: any) => b.text || "").join("").trim();

    let candidates: any[] = [];
    try {
      // The model is instructed to return only JSON, but strip fences
      // defensively in case it wraps the array in ```json anyway.
      const cleaned = raw.replace(/^```json\s*|```\s*$/g, "").trim();
      candidates = JSON.parse(cleaned);
      if (!Array.isArray(candidates)) candidates = [];
    } catch (_e) {
      candidates = [];
    }

    // Only pass through fields the client actually expects — never trust
    // the model's raw JSON shape wholesale.
    const cleanCandidates = candidates
      .filter((c) => c && typeof c.text === "string" && c.text.trim())
      .map((c) => ({
        text: String(c.text).slice(0, 2000),
        suggestedType: ["new_request", "revision", "existing_match"].includes(c.suggestedType) ? c.suggestedType : "new_request",
        matchTargetId: c.suggestedType === "existing_match" ? (c.matchTargetId ? String(c.matchTargetId) : null) : null,
        matchTargetLabel: c.suggestedType === "existing_match" ? (c.matchTargetLabel ? String(c.matchTargetLabel).slice(0, 200) : null) : null,
        confidence: ["low", "medium", "high"].includes(c.confidence) ? c.confidence : "low",
      }));

    return new Response(JSON.stringify({ candidates: cleanCandidates }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
