// Who may call the send-gmail-message function.
//
// The caller must send their Supabase login token: Authorization: Bearer <access token>.
// The token is verified with Supabase Auth, then the user must be either
//   - an admin: a row in the `admins` table with their user id, or
//   - a Sphynx team member: a card in workspace_masters.sphynx_team with their authUserId.
// This is the same rule the app uses to decide who is an admin or team member.
//
// The public anon key is also a valid JWT, but it belongs to no user, so it is refused here.
//
// Some functions also run on a schedule (the background sync). Those pass options so that a
// server-to-server caller is accepted too: the project's service role key as the bearer token,
// or a CRON_SECRET sent in the x-cron-secret header. Browser-only functions pass no options and
// accept signed-in people only.
// Pure logic plus calls on a Supabase client passed in, so it can be tested with a fake.

export type AuthOptions = { serviceKey?: string | null; cronSecret?: string | null };

export type Authz =
  | { ok: true; userId: string; role: "admin" | "team_member" | "service" }
  | { ok: false; status: 401 | 403; error: "unauthorized" | "forbidden"; message: string };

export function extractBearer(header: string | null | undefined): string {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(String(header ?? "").trim());
  return match ? match[1] : "";
}

const unauthorized = (message: string): Authz => ({ ok: false, status: 401, error: "unauthorized", message });

// Compares two strings without stopping at the first difference.
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function authorizeTeamRequest(req: Request, supabase: any, options: AuthOptions = {}): Promise<Authz> {
  // A scheduled job calling from the server, not a person.
  const cronHeader = req.headers.get("x-cron-secret") || "";
  if (options.cronSecret && cronHeader && safeEqual(cronHeader, options.cronSecret)) {
    return { ok: true, userId: "cron", role: "service" };
  }

  const token = extractBearer(req.headers.get("Authorization"));
  if (!token) return unauthorized("Sign in to use this.");
  if (options.serviceKey && safeEqual(token, options.serviceKey)) {
    return { ok: true, userId: "service", role: "service" };
  }

  let userId = "";
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) return unauthorized("Your sign-in is not valid. Sign in again.");
    userId = data.user.id;
  } catch {
    return unauthorized("Your sign-in could not be checked. Sign in again.");
  }

  try {
    const { data: admin } = await supabase.from("admins").select("id").eq("id", userId).maybeSingle();
    if (admin) return { ok: true, userId, role: "admin" };

    const { data: master } = await supabase.from("workspace_masters").select("sphynx_team").eq("id", "main_state").maybeSingle();
    const team = Array.isArray(master?.sphynx_team) ? master.sphynx_team : [];
    if (team.some((m: any) => m && m.authUserId === userId)) return { ok: true, userId, role: "team_member" };
  } catch {
    // If the lookup itself fails, refuse rather than allow.
    return { ok: false, status: 403, error: "forbidden", message: "Your account could not be checked for send permission." };
  }

  return { ok: false, status: 403, error: "forbidden", message: "Your account is not set up to do this in this app." };
}
