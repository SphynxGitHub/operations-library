export interface ProjectRule {
  clientId: string;
  labelName: string;
  emails: Set<string>;
}

// Every client with Gmail auto-labeling turned on gets a rule here, keyed by
// their Team tab email addresses. get-gmail-messages uses labelName to
// create/apply the Gmail label; get-calendar-events only needs clientId to
// auto-link an event to a project (it doesn't touch Gmail labels at all).
export async function loadProjectRules(supabase: any): Promise<ProjectRule[]> {
  const { data, error } = await supabase.from("workspace_clients").select("id, meta, project_data");
  if (error) throw new Error(`Failed to load client label rules: ${error.message}`);

  const rules: ProjectRule[] = [];
  for (const row of data || []) {
    const meta = row.meta || {};
    if (!meta.gmailLabelEnabled) continue;
    const labelName = (meta.gmailLabel || meta.name || "").trim();
    if (!labelName) continue;

    const teamMembers = row.project_data?.teamMembers || [];
    const emails = new Set<string>(
      teamMembers.map((m: any) => (m?.email || "").trim().toLowerCase()).filter(Boolean)
    );
    if (emails.size === 0) continue;

    rules.push({ clientId: row.id, labelName, emails });
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
