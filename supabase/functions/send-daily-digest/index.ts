// ================================================================================================
// FUNCTION: send-daily-digest
//
// WHAT IT DOES:   Emails each Sphynx team member a morning digest of what is new for THEM: people who
//                 tagged them (task comments and flow-map steps) and tasks assigned to them. Two
//                 sections: the previous workday 7am-5pm (7am-4pm when that workday was a Friday),
//                 and everything since then up to 6:59am today. On a Monday the second section is
//                 "after 4pm Friday, through the weekend". A digest is only sent to a person who has
//                 something new, and never on a Saturday or Sunday. A "Still unchecked" block
//                 (tags they haven't ticked as viewed, tags they sent that are still unchecked) is
//                 added to a digest that is going out anyway.
//
// CALLED BY:      A schedule (see supabase/migrations/daily_digest.sql), at 7am America/New_York.
//
// WHO CAN CALL:   The schedule (x-cron-secret header) or the service role key. Not browsers.
//
// READS/CHANGES:  Reads workspace_masters (sphynx_team), workspace_clients (project_data). Writes one
//                 row per person per day to daily_digest_log so a repeat run never sends twice.
//                 Sends through the connected Gmail account (same connection as send-gmail-message).
//
// OPTIONS (JSON body, all optional):
//                 { dryRun: true }       build every digest but send nothing; returns the previews
//                 { force: true }        ignore the "is it 7am" check (for testing)
//                 { email: "a@b.com" }   only that person
//
// A person turns it off with the "Daily digest" box in Notification settings
// (sphynx_team[i].notificationPrefs.email.dailyDigest = false). On by default for anyone with an email.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeTeamRequest } from "../_shared/auth.ts";
import { getFreshGoogleAccessToken, GoogleAuthError } from "../_shared/google-token.ts";
import { buildRawMessage, base64UrlEncode } from "../_shared/mime.ts";
import { activityFor, buildDigest, digestWindows, isDigestHour, uncheckedFor } from "../_shared/daily-digest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const authz = await authorizeTeamRequest(req, supabase, { serviceKey, cronSecret: Deno.env.get("CRON_SECRET") });
    if (!authz.ok || authz.role !== "service") {
      const a: any = authz;
      return json({ error: a.error || "forbidden", message: a.message || "Only the schedule can run this." }, a.status || 403);
    }

    const opts = await req.json().catch(() => ({}));
    const now = new Date();
    if (!opts.force && !isDigestHour(now)) return json({ skipped: "not 7am in America/New_York" });
    const windows = digestWindows(now);
    if (!windows) return json({ skipped: "weekend" });

    const { data: master } = await supabase.from("workspace_masters").select("*").eq("id", "main_state").maybeSingle();
    const team: any[] = Array.isArray(master?.sphynx_team) ? master.sphynx_team : [];
    const statuses: any[] = Array.isArray(master?.task_statuses) ? master.task_statuses : [];
    const closedNames = statuses.filter((s) => s?.isClosed).map((s) => s.name);
    const { data: clients } = await supabase.from("workspace_clients").select("id, meta, project_data");

    const wanted = String(opts.email || "").trim().toLowerCase();
    const results: any[] = [];
    let accessToken = "", fromAddress = "";

    for (const member of team) {
      const email = String(member?.email || "").trim();
      if (!email || !member?.name) continue;
      if (wanted && email.toLowerCase() !== wanted) continue;
      if (member?.notificationPrefs?.email?.dailyDigest === false) { results.push({ to: email, skipped: "turned off" }); continue; }

      const workday = activityFor(member.name, clients || [], windows.workday, closedNames.length ? closedNames : ["Done"]);
      const overnight = activityFor(member.name, clients || [], windows.overnight, closedNames.length ? closedNames : ["Done"]);
      const digest = buildDigest(member.name, workday, overnight, uncheckedFor(member.name, clients || [], closedNames.length ? closedNames : ["Done"]), windows);
      if (!digest) { results.push({ to: email, skipped: "no activity" }); continue; }

      if (opts.dryRun) { results.push({ to: email, subject: digest.subject, count: digest.count, text: digest.text }); continue; }

      // One digest per person per day: claim the day first, release it if the send fails so a retry can send.
      const memberKey = String(member.id || email);
      const { error: claimErr } = await supabase.from("daily_digest_log").insert({ digest_date: windows.digestDate, member_key: memberKey });
      if (claimErr) { results.push({ to: email, skipped: claimErr.code === "23505" ? "already sent today" : `log failed: ${claimErr.message}` }); continue; }

      try {
        if (!accessToken) {
          accessToken = await getFreshGoogleAccessToken(supabase);
          const { data: tokenRow } = await supabase.from("google_auth_tokens").select("email").order("updated_at", { ascending: false }).limit(1).single();
          fromAddress = tokenRow?.email || "team@sphynxautomation.com";
        }
        const raw = base64UrlEncode(buildRawMessage({ from: fromAddress, to: email, subject: digest.subject, body: digest.text, html: digest.html }));
        const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        });
        if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
        results.push({ to: email, sent: true, count: digest.count });
      } catch (e) {
        await supabase.from("daily_digest_log").delete().eq("digest_date", windows.digestDate).eq("member_key", memberKey);
        results.push({ to: email, error: e instanceof GoogleAuthError ? "Google is not connected" : String((e as Error).message || e) });
      }
    }

    return json({ date: windows.digestDate, sent: results.filter((r) => r.sent).length, results });
  } catch (e) {
    console.error("send-daily-digest failed:", e);
    return json({ error: "digest_failed", message: String((e as Error).message || e) }, 500);
  }
});
