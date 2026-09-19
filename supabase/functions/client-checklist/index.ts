// ================================================================================================
// FUNCTION: client-checklist
//
// WHAT IT DOES:   Gives the client's testing checklist page its data. The page (checklist.html on your
//                 site) opens from a private link in the review email. The link carries an unguessable
//                 token; this function looks the token up and returns that one checklist as JSON.
//                 (Supabase does not serve web pages from functions, so the page itself is a static
//                 file and this only supplies the data.)
//
// CALLED BY:      checklist.html, when a client opens the link from the review notification email.
//
// WHO CAN CALL:   Anyone who has the token. The token is 43 random characters, so it cannot be guessed;
//                 there is no login. An unknown, revoked or badly formed token gets the same 404, so
//                 nothing can be learned by trying tokens.
//
// READS/CHANGES:  Reads one row of client_checklists. Changes nothing. It returns only what the client
//                 should see: the client's name, the round, the review dates, the steps to check, and the
//                 email address to report problems to. Never any internal notes or results.
//
// NEEDS:          The client_checklists table from 014_client_checklists.sql.
//
// CHANGED FROM THE ORIGINAL: New function.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer"
};

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const notFound = () => new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "Use GET" }), { status: 405, headers: corsHeaders });

  try {
    const token = new URL(req.url).searchParams.get("t") || "";
    if (!TOKEN_RE.test(token)) return notFound();

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await supabase
      .from("client_checklists")
      .select("client_name, round, review_start, review_end, contact_email, sections, revoked")
      .eq("token", token)
      .maybeSingle();

    if (error) {
      console.error("client-checklist lookup failed:", error.message);
      return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers: corsHeaders });
    }
    if (!data || data.revoked) return notFound();

    return new Response(JSON.stringify({
      clientName: data.client_name,
      round: data.round,
      reviewStart: data.review_start,
      reviewEnd: data.review_end,
      contactEmail: data.contact_email,
      sections: data.sections
    }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    console.error("client-checklist failed:", err.message);
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers: corsHeaders });
  }
});
