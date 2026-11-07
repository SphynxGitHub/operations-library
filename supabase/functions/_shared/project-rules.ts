export interface ProjectRule {
  clientId: string;
  clientName: string;
  labelName: string;
  labelingEnabled: boolean; // whether to actually apply a Gmail label — matching/linking works regardless of this
  emails: Set<string>;
}

// Every project's Team tab (project_data.teamMembers) and, when asked, its meta, WITHOUT downloading the rest of each project.
// A whole project is 100 KB to 3 MB and a full pass over them all is ~28 MB; the scheduled sync runs this every few minutes, so
// reading everything just to get email addresses cost gigabytes of egress a day. If Supabase ever rejects the narrow form it falls
// back to the old full read, so matching keeps working (at the old cost) rather than silently stopping.
export async function loadClientTeams(supabase: any, withMeta = false): Promise<{ data: any[] | null; error: any }> {
  const narrow = await supabase.from("workspace_clients").select(withMeta ? "id, meta, team:project_data->teamMembers" : "id, team:project_data->teamMembers");
  if (!narrow.error) {
    return { data: (narrow.data || []).map((r: any) => ({ ...r, team: Array.isArray(r.team) ? r.team : [] })), error: null };
  }
  console.warn("Narrow Team tab read failed, using the full read:", narrow.error.message);
  const full = await supabase.from("workspace_clients").select(withMeta ? "id, meta, project_data" : "id, project_data");
  if (full.error) return { data: null, error: full.error };
  return { data: (full.data || []).map((r: any) => ({ id: r.id, meta: r.meta, team: r.project_data?.teamMembers || [] })), error: null };
}

// Every client with at least one Team tab email gets a matching rule here —
// matching itself is NOT gated behind the Gmail-label toggle (that toggle
// only controls whether get-gmail-messages also applies a literal label in
// Gmail, a separate cosmetic step). Previously both were gated together,
// which meant calendar event auto-linking — which has nothing to do with
// Gmail labels — silently did nothing for any client that hadn't opted
// into Gmail labeling specifically.
export async function loadProjectRules(supabase: any): Promise<ProjectRule[]> {
  const { data, error } = await loadClientTeams(supabase, true);
  if (error) throw new Error(`Failed to load client label rules: ${error.message}`);

  const rules: ProjectRule[] = [];
  for (const row of data || []) {
    const meta = row.meta || {};
    const clientName = (meta.name || "").trim();

    const teamMembers = row.team || [];
    const emails = new Set<string>(
      teamMembers.map((m: any) => (m?.email || "").trim().toLowerCase()).filter(Boolean)
    );
    if (emails.size === 0) continue; // nothing to match against either way

    const labelName = (meta.gmailLabel || clientName || "").trim();
    rules.push({
      clientId: row.id,
      clientName,
      labelName,
      labelingEnabled: !!meta.gmailLabelEnabled && !!labelName,
      emails
    });
  }
  return rules;
}

// Given a set of participant email addresses (From/To/Cc, or Calendar
// organizer/attendees), returns the ids of every project whose Team tab
// emails intersect with it.
export function matchProjectRules(rules: ProjectRule[], participantEmails: Set<string>): ProjectRule[] {
  const matched: ProjectRule[] = [];
  for (const rule of rules) {
    for (const addr of participantEmails) {
      if (rule.emails.has(addr)) {
        matched.push(rule);
        break;
      }
    }
  }
  return matched;
}

// Fallback for calendar events specifically: matches a project by its name
// appearing in the event's subject/title or description, for events where
// no attendee email lines up with a Team tab entry (e.g. an internal-only
// invite, or the client's real Team tab email differs from who's actually
// on the calendar invite). Word-boundary match on the client's name so
// "Wealth Innovation Group" doesn't accidentally match a substring inside
// an unrelated longer name.
export function matchProjectRulesByText(rules: ProjectRule[], text: string): ProjectRule[] {
  const haystack = (text || "").toLowerCase();
  if (!haystack.trim()) return [];
  const matched: ProjectRule[] = [];
  for (const rule of rules) {
    const needle = rule.clientName.trim().toLowerCase();
    if (needle.length < 3) continue; // too short to match meaningfully (avoids noisy false positives)
    const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(haystack)) matched.push(rule);
  }
  return matched;
}
