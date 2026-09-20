// ================================================================================================
// FUNCTION: client-checklist
//
// WHAT IT DOES:   Gives the client's testing checklist page its data, and saves the client's answers.
//                 The page (checklist.html on your site) opens from a private link in the review email.
//                 The link carries an unguessable token.
//                   GET  ?t=<token>            returns that one checklist, with any answers already given
//                   POST {t, stepId, result, note}   saves the client's Pass or Fail for one step (a Fail
//                                                    needs a note saying what went wrong)
//                 (Supabase does not serve web pages from functions, so the page itself is a static
//                 file and this only supplies the data.)
//
// CALLED BY:      checklist.html, when a client opens the link from the review notification email and
//                 marks a step.
//
// WHO CAN CALL:   Anyone who has the token. The token is 43 random characters, so it cannot be guessed;
//                 there is no login. An unknown, revoked or badly formed token gets the same 404, so
//                 nothing can be learned by trying tokens.
//
// READS/CHANGES:  Reads one row of client_checklists. Saves answers in client_checklist_results (the app
//                 picks up each Fail and opens a task for it). It returns only what the client should see:
//                 the client's name, the round, the review dates, the steps to check, their own answers,
//                 and the email address to report problems to. Never any internal notes or results. A
//                 token can only answer the steps that are in its own checklist.
//
// NEEDS:          The client_checklists table (014_client_checklists.sql) and client_checklist_results (015_client_review.sql).
//
// CHANGED FROM THE ORIGINAL: New function. Now also saves the client's answers.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer"
};

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const STEP_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const MAX_BODY = 8000;
const NOTE_MIN = 3;
const NOTE_MAX = 2000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const notFound = () => json({ error: "not_found" }, 404);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Use GET or POST" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---- POST: save one answer ----
    if (req.method === "POST") {
      const text = await req.text();
      if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);
      let body: any;
      try { body = JSON.parse(text); } catch { return json({ error: "bad_request", message: "Body must be valid JSON." }, 400); }

      const token = String(body?.t || "");
      if (!TOKEN_RE.test(token)) return notFound();
      const stepId = String(body?.stepId || "");
      const result = String(body?.result || "");
      if (!STEP_RE.test(stepId) || (result !== "pass" && result !== "fail")) return json({ error: "bad_request", message: "A step and a Pass or Fail are required." }, 400);
      const note = String(body?.note ?? "").trim();
      if (result === "fail" && (note.length < NOTE_MIN)) return json({ error: "note_required", message: "Please tell us what went wrong, in a few words." }, 400);
      if (note.length > NOTE_MAX) return json({ error: "note_too_long", message: "That note is too long. Please shorten it." }, 400);

      const { data: row, error: rowErr } = await supabase
        .from("client_checklists").select("client_id, sections, revoked").eq("token", token).maybeSingle();
      if (rowErr) { console.error("client-checklist lookup failed:", rowErr.message); return json({ error: "server_error" }, 500); }
      if (!row || row.revoked) return notFound();

      // only a step that is really in THIS checklist can be answered
      const known = (Array.isArray(row.sections) ? row.sections : []).some((s: any) => (Array.isArray(s?.steps) ? s.steps : []).some((st: any) => st?.id === stepId));
      if (!known) return json({ error: "unknown_step", message: "That step is not in this checklist." }, 400);

      const now = new Date().toISOString();
      const { error: saveErr } = await supabase.from("client_checklist_results").upsert({
        token, step_id: stepId, client_id: row.client_id, result,
        note: result === "fail" ? note : null,
        updated_at: now,
        ingested_at: result === "pass" ? now : null,   // a Fail waits for the app to open its task
      }, { onConflict: "token,step_id" });
      if (saveErr) { console.error("client-checklist save failed:", saveErr.message); return json({ error: "server_error" }, 500); }
      return json({ ok: true });
    }

    // ---- GET: the checklist, with the answers already given ----
    const token = new URL(req.url).searchParams.get("t") || "";
    if (!TOKEN_RE.test(token)) return notFound();

    const { data, error } = await supabase
      .from("client_checklists")
      .select("client_name, round, review_start, review_end, contact_email, sections, revoked")
      .eq("token", token)
      .maybeSingle();

    if (error) {
      console.error("client-checklist lookup failed:", error.message);
      return json({ error: "server_error" }, 500);
    }
    if (!data || data.revoked) return notFound();

    const { data: answerRows } = await supabase.from("client_checklist_results").select("step_id, result, note").eq("token", token);
    const answers: Record<string, { result: string; note: string }> = {};
    (answerRows || []).forEach((a: any) => { answers[a.step_id] = { result: a.result, note: a.note || "" }; });

    return json({
      clientName: data.client_name,
      round: data.round,
      reviewStart: data.review_start,
      reviewEnd: data.review_end,
      contactEmail: data.contact_email,
      sections: data.sections,
      answers
    });

  } catch (err: any) {
    console.error("client-checklist failed:", err.message);
    return json({ error: "server_error" }, 500);
  }
});
