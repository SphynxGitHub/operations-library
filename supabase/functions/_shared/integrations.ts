// The read-only "pull in workflow copies" calls to each outside service, run on the server so the
// client's API key never reaches the browser. This is the same set of calls the old Firebase
// proxies made (each returns the same shape the app already expects), with three changes:
//   - the key comes from secure storage, not from the web address;
//   - every address is fixed or checked against an allow-list, so this cannot be used to reach
//     anything else (the old ActiveCampaign proxy would fetch any address it was given);
//   - errors are trimmed and have the key removed before they are sent back.
// Pure code apart from the fetch function that is passed in, so it can be tested on its own.

export const SERVICES = ["wealthbox", "jotform", "calendly", "activecampaign", "mailerlite", "mailchimp", "slant", "keap", "ycbm", "redtail", "processstreet"] as const;
export type Service = typeof SERVICES[number];

export class UpstreamError extends Error {
  status: number;
  url = "";
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export class BadRequest extends Error {}

type FetchFn = (url: string, init?: any) => Promise<Response>;
const TIMEOUT_MS = 25_000;

export function redact(text: string, key: string): string {
  let out = String(text ?? "");
  if (key && key.length >= 4) out = out.split(key).join("[key]");
  return out.slice(0, 300);
}

async function getJson(f: FetchFn, url: string, headers: Record<string, string>, key: string): Promise<any> {
  const res = await f(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) { const e = new UpstreamError(res.status, redact(text, key)); e.url = url.split("?")[0].replace(/^https:\/\//, ""); throw e; }
  try { return JSON.parse(text); } catch { throw new UpstreamError(502, "The service did not return JSON."); }
}

// Mailchimp keys end with the data centre the account lives on ("...-us21"); the API address is built from it. Only that
// shape is accepted, so the address can only ever be https://<dc>.api.mailchimp.com.
export function mailchimpBase(rawKey: unknown): string {
  const m = /^[A-Za-z0-9]{16,64}-([a-z]{2,4}\d{1,3})$/.exec(String(rawKey ?? "").trim());
  if (!m) throw new BadRequest("A Mailchimp API key ends with a dash and a code like -us21. Check that the whole key was entered.");
  return `https://${m[1]}.api.mailchimp.com/3.0`;
}

// ActiveCampaign accounts live at https://<account>.api-us1.com (or .activehosted.com). Anything else is refused.
export function cleanActiveCampaignBase(raw: unknown): string {
  const base = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]{1,63}\.(api-us1\.com|activehosted\.com)$/i.test(base)) {
    throw new BadRequest("The ActiveCampaign address must look like https://accountname.api-us1.com");
  }
  return base;
}

// A form's conditional logic: the rules (show/hide, skip to a page, send an email...) and the questions they refer to.
// Jotform returns each rule's "terms" and "action" as JSON text, and the whole list as text on some accounts; they are
// handed on as they come and read by the app (core/jotform-logic.js). Only the form id and the key are sent to Jotform.
// Jotform keeps HIPAA and EU accounts on their own API addresses (jotform.com/apidocs); a key only works on its own.
export function jotformApiBase(region: unknown): string {
  const r = String(region ?? "").trim().toLowerCase();
  if (r === "" || r === "standard" || r === "us") return "https://api.jotform.com";
  if (r === "hipaa") return "https://hipaa-api.jotform.com";
  if (r === "eu") return "https://eu-api.jotform.com";
  throw new BadRequest("The Jotform account type should be left blank (standard), or be HIPAA or EU.");
}

export async function jotformFormLogic(formId: unknown, key: string, f: FetchFn, region: unknown = ""): Promise<any> {
  const id = String(formId ?? "").trim();
  if (!/^\d{6,20}$/.test(id)) throw new BadRequest("The form id must be the number from the form's address.");
  const k = encodeURIComponent(key);
  const base = jotformApiBase(region);
  const [props, qs] = await Promise.all([
    getJson(f, `${base}/form/${id}/properties?apiKey=${k}`, {}, key),
    getJson(f, `${base}/form/${id}/questions?apiKey=${k}`, {}, key),
  ]);
  let conditions: any = props?.content?.conditions ?? props?.content?.properties?.conditions ?? [];
  if (typeof conditions === "string") { try { conditions = JSON.parse(conditions); } catch { conditions = []; } }
  if (!Array.isArray(conditions)) conditions = Object.values(conditions || {});
  const questions = Object.values(qs?.content || {}).map((q: any) => ({
    qid: String(q?.qid ?? ""), type: String(q?.type ?? ""), text: String(q?.text ?? "").slice(0, 200), name: String(q?.name ?? "").slice(0, 80),
    order: Number(q?.order) || 0, options: typeof q?.options === "string" ? q.options.slice(0, 400) : "",
  })).filter((q: any) => q.qid);
  // The emails the form sends (notifications to the team, autoresponders to the person who filled it in). Only what each one is
  // called, its subject, its message and whether it carries the PDF are handed on, not the addresses.
  let emailsRaw: any = props?.content?.emails ?? props?.content?.properties?.emails ?? [];
  if (typeof emailsRaw === "string") { try { emailsRaw = JSON.parse(emailsRaw); } catch { emailsRaw = []; } }
  if (!Array.isArray(emailsRaw)) emailsRaw = Object.values(emailsRaw || {});
  const emails = emailsRaw.filter((e: any) => e && typeof e === "object").slice(0, 12).map((e: any, i: number) => ({
    id: String(e?.id ?? i), type: String(e?.type ?? "").toLowerCase().slice(0, 30), name: String(e?.name ?? "").slice(0, 80), subject: String(e?.subject ?? "").slice(0, 160),
    // the message itself (HTML, with the form's {field} placeholders) and whether Jotform attaches the submission as a PDF
    body: String(e?.body ?? e?.html_body ?? (typeof e?.html === "string" && e.html.length > 2 ? e.html : "") ?? "").slice(0, 20000),
    attachPdf: ["1", "true", "yes"].includes(String(e?.attachPDF ?? e?.attachPdf ?? "").toLowerCase()),
  }));
  return { form_id: id, conditions, questions, emails };
}

export async function runImport(service: Service, key: string, opts: { baseUrl?: string; page?: number; email?: string; formId?: string; calendlyUser?: string; region?: string }, f: FetchFn): Promise<any> {
  switch (service) {
    case "wealthbox": {
      let all: any[] = [];
      for (let page = 1; page <= 20; page++) {
        const data = await getJson(f, `https://api.crmworkspace.com/v1/workflow_templates?page=${page}`, { ACCESS_TOKEN: key }, key);
        const templates = data.workflow_templates || [];
        all = all.concat(templates);
        if (templates.length !== 25) break;
      }
      return { workflow_templates: all };
    }
    case "jotform": {
      if (opts.formId !== undefined && opts.formId !== null && opts.formId !== "") return await jotformFormLogic(opts.formId, key, f, opts.region);
      let all: any[] = [];
      const limit = 50;
      for (let offset = 0; offset < 500; offset += limit) {
        const data = await getJson(f, `${jotformApiBase(opts.region)}/user/forms?apiKey=${encodeURIComponent(key)}&offset=${offset}&limit=${limit}&orderby=id`, {}, key);
        const content = data.content || [];
        all = all.concat(content);
        if (content.length !== limit) break;
      }
      return { content: all };
    }
    case "calendly": {
      // A user ID entered with the key skips the /users/me call, which needs the "users" scope.
      const given = String(opts.calendlyUser ?? "").trim().split("/").pop() || "";
      let uri: string | undefined;
      if (given) {
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(given)) throw new BadRequest("The Calendly user ID should be the ID from the user's address (api.calendly.com/users/<id>).");
        uri = `https://api.calendly.com/users/${given}`;
      } else {
        const me = await getJson(f, "https://api.calendly.com/users/me", { Authorization: `Bearer ${key}` }, key);
        uri = me?.resource?.uri;
      }
      if (!uri) throw new UpstreamError(502, "Calendly did not return a user.");
      return await getJson(f, `https://api.calendly.com/event_types?user=${encodeURIComponent(uri)}`, { Authorization: `Bearer ${key}` }, key);
    }
    case "activecampaign": {
      const base = cleanActiveCampaignBase(opts.baseUrl);
      return await getJson(f, `${base}/api/3/automations`, { "Api-Token": key }, key);
    }
    case "mailerlite":
      return await getJson(f, "https://connect.mailerlite.com/api/automations", { Authorization: `Bearer ${key}` }, key);
    case "mailchimp": {
      // Classic Automations (Marketing API v3) with each automation's emails. Mailchimp's newer Customer Journeys builder is not
      // listed by this API, so only classic automations come back. Basic login: any user name, the API key as the password.
      const base = mailchimpBase(key);
      const auth = { Authorization: `Basic ${btoa(`sphynx:${key.trim()}`)}` };
      const aFields = "total_items,automations.id,automations.status,automations.create_time,automations.start_time,automations.settings.title,automations.trigger_settings.workflow_type,automations.trigger_settings.workflow_title,automations.recipients.list_name";
      let automations: any[] = [];
      let truncated = false;
      for (let offset = 0, pages = 0; ; pages++, offset += 100) {
        if (pages >= 5) { truncated = true; break; }
        const data = await getJson(f, `${base}/automations?count=100&offset=${offset}&fields=${aFields}`, auth, key);
        const page: any[] = data.automations || [];
        automations = automations.concat(page);
        if (page.length < 100 || automations.length >= (data.total_items ?? 0)) break;
      }
      // The emails inside each automation are one call each, a few at a time. A failure on one automation (for example
      // Mailchimp refusing that one) leaves it without emails and flagged, instead of failing the whole pull.
      const eFields = "emails.id,emails.position,emails.status,emails.delay,emails.settings.title,emails.settings.subject_line";
      let next = 0;
      const worker = async () => {
        while (next < automations.length) {
          const a = automations[next++];
          if (!/^[A-Za-z0-9]{4,40}$/.test(String(a?.id ?? ""))) { a.emails = []; continue; }
          try {
            const d = await getJson(f, `${base}/automations/${a.id}/emails?fields=${eFields}`, auth, key);
            a.emails = (d.emails || []).slice().sort((x: any, y: any) => (x.position ?? 0) - (y.position ?? 0));
          } catch (e) {
            if (e instanceof UpstreamError && (e.status === 401)) throw e;
            a.emails = []; a.emailsError = true;
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker(), worker()]);
      return { automations, truncated };
    }
    case "slant": {
      // Slant "project templates" are its workflows: each has milestones (the stages), with outcomes and form fields. Personal access
      // tokens are read-only by default, which is all this needs. Pages of up to 100; only the fields the app uses are passed on
      // (the attachments' signed download links are left out on purpose).
      const SLANT = "https://api.slant.app/v1";
      const auth = { Authorization: `Bearer ${key.trim()}` };
      let templates: any[] = [];
      let truncated = false;
      for (let page = 1; ; page++) {
        if (page > 10) { truncated = true; break; }
        const data = await getJson(f, `${SLANT}/project-templates?page=${page}&per_page=100`, auth, key);
        for (const t of (data.data || [])) {
          templates.push({
            id: t.id, title: t.title, description: t.description, archived_at: t.archived_at, projectable_kind: t.projectable_kind,
            enforce_sequential_milestones: t.enforce_sequential_milestones, company_wide: t.company_wide, updated_at: t.updated_at,
            project_milestones: (t.project_milestones || []).map((m: any) => ({
              id: m.id, title: m.title, sort_order: m.sort_order, auto_advance_trigger: m.auto_advance_trigger, auto_complete_tasks: m.auto_complete_tasks,
              project_milestone_outcomes: (m.project_milestone_outcomes || []).map((o: any) => ({
                id: o.id, label: o.label, destination: o.destination, sort_order: o.sort_order, target_project_milestone_id: o.target_project_milestone_id,
              })),
              project_milestone_form_fields: (m.project_milestone_form_fields || []).map((x: any) => ({
                id: x.id, label: x.label, field_type: x.field_type, required: x.required, sort_order: x.sort_order, select_options: x.select_options,
              })),
            })),
          });
        }
        if (page >= Number(data.pagination?.total_pages || 1)) break;
      }
      // Slant's automations come back as just an id and a name (no triggers or actions), so only those two are kept. If this list
      // cannot be read the whole pull fails, so existing cards are never wrongly reported as removed.
      const automations: any[] = [];
      for (let page = 1; ; page++) {
        if (page > 10) { truncated = true; break; }
        const data = await getJson(f, `${SLANT}/automations?page=${page}&per_page=100`, auth, key);
        for (const a of (data.data || [])) automations.push({ id: a.id, name: a.name });
        if (page >= Number(data.pagination?.total_pages || 1)) break;
      }
      return { templates, automations, truncated };
    }
    case "keap": {
      // Keap (Infusionsoft) REST v1 with a Service Account Key sent as a Bearer token (developer.keap.com/pat-and-sak). Campaigns come back a page at a time with the
      // names of their sequences; the steps inside a sequence are not available through the API.
      const KEAP = "https://api.infusionsoft.com/crm/rest/v1";
      const auth = { Authorization: `Bearer ${key}` };
      // Pages are asked for by offset (Keap's own "next" link is not followed: it has come back malformed). Sequence
      // names are an optional extra; if Keap refuses that option the list is fetched without it.
      let withSequences = true;
      let campaigns: any[] = [];
      for (let offset = 0, pages = 0; pages < 10; pages++, offset += 200) {
        const q = `limit=200&offset=${offset}${withSequences ? "&optional_properties=sequences" : ""}`;
        let data: any;
        try {
          data = await getJson(f, `${KEAP}/campaigns?${q}`, auth, key);
        } catch (e) {
          if (withSequences && e instanceof UpstreamError && e.status >= 400 && e.status !== 401 && e.status !== 403) {
            withSequences = false; offset -= 200; pages--; continue;
          }
          throw e;
        }
        const page: any[] = data.campaigns || [];
        campaigns = campaigns.concat(page);
        if (page.length < 200) break;
      }
      return { campaigns };
    }
    case "ycbm": {
      // A raw key (starts with ak_) is combined with the account email into the Basic login; a key that
      // is already the encoded login is used as it is. This used to happen in the browser.
      let basic = key.trim();
      if (basic.startsWith("ak_")) {
        const email = String(opts.email ?? "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequest("The YouCanBookMe account email is needed.");
        basic = btoa(`${email}:${basic}`);
      }
      return await getJson(f, "https://api.youcanbook.me/v1/profiles", { Authorization: `Basic ${basic}` }, key);
    }
    case "redtail": {
      const page = Number.isInteger(opts.page) && (opts.page as number) >= 1 && (opts.page as number) <= 200 ? opts.page : 1;
      return await getJson(f, `https://smf.crm3.redtailtechnology.com/api/public/v1/workflows/templates?page=${page}`, { Authorization: key }, key);
    }
    case "processstreet": {
      let all: any[] = [];
      let next: string | null = "https://public-api.process.st/api/v1.1/workflows";
      while (next) {
        const data: any = await getJson(f, next, { "X-API-Key": key }, key);
        all = all.concat(data.workflows || []);
        const link = (data.links || []).find((l: any) => l.rel === "next");
        next = null;
        if (link?.href && all.length <= 500) {
          // only ever follow a "next page" link that stays on Process Street
          try { const u = new URL(link.href); if (u.protocol === "https:" && u.hostname === "public-api.process.st") next = u.toString(); } catch { /* ignore */ }
        }
      }
      const items: any[] = [];
      for (let i = 0; i < all.length; i += 8) {
        const batch = all.slice(i, i + 8);
        const done = await Promise.all(batch.map(async (wf: any) => {
          try {
            const t = await getJson(f, `https://public-api.process.st/api/v1.1/workflows/${encodeURIComponent(String(wf.id))}/tasks`, { "X-API-Key": key }, key);
            return { ...wf, tasks: t.tasks || t.items || [] };
          } catch { return { ...wf, tasks: [] }; }
        }));
        items.push(...done);
      }
      return { items };
    }
  }
}
