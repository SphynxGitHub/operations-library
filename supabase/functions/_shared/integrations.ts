// The read-only "pull in workflow copies" calls to each outside service, run on the server so the
// client's API key never reaches the browser. This is the same set of calls the old Firebase
// proxies made (each returns the same shape the app already expects), with three changes:
//   - the key comes from secure storage, not from the web address;
//   - every address is fixed or checked against an allow-list, so this cannot be used to reach
//     anything else (the old ActiveCampaign proxy would fetch any address it was given);
//   - errors are trimmed and have the key removed before they are sent back.
// Pure code apart from the fetch function that is passed in, so it can be tested on its own.

export const SERVICES = ["wealthbox", "jotform", "calendly", "activecampaign", "mailerlite", "ycbm", "redtail", "processstreet"] as const;
export type Service = typeof SERVICES[number];

export class UpstreamError extends Error {
  status: number;
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
  if (!res.ok) throw new UpstreamError(res.status, redact(text, key));
  try { return JSON.parse(text); } catch { throw new UpstreamError(502, "The service did not return JSON."); }
}

// ActiveCampaign accounts live at https://<account>.api-us1.com (or .activehosted.com). Anything else is refused.
export function cleanActiveCampaignBase(raw: unknown): string {
  const base = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]{1,63}\.(api-us1\.com|activehosted\.com)$/i.test(base)) {
    throw new BadRequest("The ActiveCampaign address must look like https://accountname.api-us1.com");
  }
  return base;
}

export async function runImport(service: Service, key: string, opts: { baseUrl?: string; page?: number; email?: string }, f: FetchFn): Promise<any> {
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
      let all: any[] = [];
      const limit = 50;
      for (let offset = 0; offset < 500; offset += limit) {
        const data = await getJson(f, `https://api.jotform.com/user/forms?apiKey=${encodeURIComponent(key)}&offset=${offset}&limit=${limit}&orderby=id`, {}, key);
        const content = data.content || [];
        all = all.concat(content);
        if (content.length !== limit) break;
      }
      return { content: all };
    }
    case "calendly": {
      const me = await getJson(f, "https://api.calendly.com/users/me", { Authorization: `Bearer ${key}` }, key);
      const uri = me?.resource?.uri;
      if (!uri) throw new UpstreamError(502, "Calendly did not return a user.");
      return await getJson(f, `https://api.calendly.com/event_types?user=${encodeURIComponent(uri)}`, { Authorization: `Bearer ${key}` }, key);
    }
    case "activecampaign": {
      const base = cleanActiveCampaignBase(opts.baseUrl);
      return await getJson(f, `${base}/api/3/automations`, { "Api-Token": key }, key);
    }
    case "mailerlite":
      return await getJson(f, "https://connect.mailerlite.com/api/automations", { Authorization: `Bearer ${key}` }, key);
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
