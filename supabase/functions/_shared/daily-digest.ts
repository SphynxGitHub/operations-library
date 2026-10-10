// Daily digest: who gets what, and how it reads. Pure functions, no database and no network, so they can be tested
// with plain objects. The send-daily-digest function loads the data and sends the result.
//
// The digest goes out at 7am (DIGEST_TZ) on weekdays and has two sections of NEW activity for one person:
//   1. Previous workday 7:00am to 5:00pm (to 4:00pm when that workday was a Friday)
//   2. Overnight: from the end of that section up to 6:59am today. On a Monday this is "after 4pm Friday" through the
//      weekend, all rolled into Monday's notice. No digest is sent on Saturday or Sunday.
// Activity = people tagging them in a task comment or a flow-map step, and tasks assigned to them. When both sections
// are empty nothing is sent. A third block, "Still unchecked", is added to a digest that is being sent anyway: tags of
// them they haven't ticked as viewed, and tags they sent that someone hasn't ticked yet. It never causes a send alone.

export const DIGEST_TZ = "America/New_York";
export const DIGEST_HOUR = 7;
export const WORKDAY_START = 7;   // 7am
export const WORKDAY_END = 17;    // 5pm
export const FRIDAY_END = 16;     // Friday's workday section stops at 4pm: whatever comes after rolls into Monday's overnight/weekend section
const MAX_UNCHECKED = 15;

type Parts = { y: number; m: number; d: number; h: number; min: number; weekday: number };

// The wall-clock parts of an instant in a time zone. weekday: 0 = Sunday ... 6 = Saturday.
export function zonedParts(date: Date, tz = DIGEST_TZ): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const p: Record<string, string> = {};
  f.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, weekday };
}

// The instant at which the wall clock in `tz` reads y-m-d h:min. Settles on the right offset across daylight saving.
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, min: number, tz = DIGEST_TZ): Date {
  const target = Date.UTC(y, m - 1, d, h, min);
  let utc = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(utc), tz);
    utc += target - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  }
  return new Date(utc);
}

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export type Windows = {
  digestDate: string;              // today in DIGEST_TZ, YYYY-MM-DD (one digest per person per date)
  prevWorkday: string;             // YYYY-MM-DD
  prevLabel: string;               // "Fri Oct 9"
  endHour: number;                 // where the previous workday's section stops (16 after a Friday, else 17)
  workday: { from: Date; to: Date };
  overnight: { from: Date; to: Date };
};

// null on a weekend: the digest is a weekday thing, and Monday's overnight section already covers the weekend.
export function digestWindows(now: Date, tz = DIGEST_TZ): Windows | null {
  const t = zonedParts(now, tz);
  if (t.weekday === 0 || t.weekday === 6) return null;
  const back = t.weekday === 1 ? 3 : 1;   // Monday looks back to Friday
  const noon = new Date(Date.UTC(t.y, t.m - 1, t.d, 12));
  noon.setUTCDate(noon.getUTCDate() - back);
  const py = noon.getUTCFullYear(), pm = noon.getUTCMonth() + 1, pd = noon.getUTCDate();
  const todayStart7 = zonedTimeToUtc(t.y, t.m, t.d, DIGEST_HOUR, 0, tz);
  const endHour = back === 3 ? FRIDAY_END : WORKDAY_END;   // back === 3: Monday, so the previous workday is a Friday
  return {
    digestDate: ymd(t.y, t.m, t.d),
    prevWorkday: ymd(py, pm, pd),
    prevLabel: noon.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
    endHour,
    workday: { from: zonedTimeToUtc(py, pm, pd, WORKDAY_START, 0, tz), to: zonedTimeToUtc(py, pm, pd, endHour, 0, tz) },
    overnight: { from: zonedTimeToUtc(py, pm, pd, endHour, 0, tz), to: todayStart7 },
  };
}

// The send hour check: true at 7am in DIGEST_TZ.
export const isDigestHour = (now: Date, tz = DIGEST_TZ) => zonedParts(now, tz).h === DIGEST_HOUR;

// ---------------------------------------------------------------------------------------------------------------------
// activity
// ---------------------------------------------------------------------------------------------------------------------
export type DigestItem = { at: string; kind: "tag" | "assigned"; text: string; project: string };
export type Unchecked = { text: string; project: string; at: string };

const lc = (v: unknown) => String(v ?? "").trim().toLowerCase();
const inWindow = (iso: unknown, w: { from: Date; to: Date }) => {
  const t = Date.parse(String(iso ?? ""));
  return !Number.isNaN(t) && t >= w.from.getTime() && t < w.to.getTime();
};
const isMentioned = (c: any, name: string) => (c?.mentions || []).some((m: any) => lc(m?.name) === name);
const viewedBy = (c: any, name: string) => (c?.viewedBy || []).some((v: any) => lc(v?.name) === name);
const assignedTo = (t: any, name: string) =>
  lc(t?.assignee) === name || (Array.isArray(t?.assignees) && t.assignees.some((a: any) => lc(a) === name));

export type DigestClient = { id: string; meta?: { name?: string }; project_data?: any };

// Everything new for one person in `window`, newest last.
export function activityFor(memberName: string, clients: DigestClient[], window: { from: Date; to: Date }, closedNames: string[] = ["Done"]): DigestItem[] {
  const me = lc(memberName);
  const closed = new Set(closedNames);
  const out: DigestItem[] = [];
  clients.forEach((client) => {
    const project = client.meta?.name || client.id;
    const pd = client.project_data || {};
    (pd.clientTasks || []).forEach((task: any) => {
      if (!task) return;
      const title = task.title || task.name || "a task";
      (task.comments || []).forEach((c: any) => {
        if (lc(c?.author) === me || !isMentioned(c, me) || !inWindow(c.date, window)) return;
        out.push({ at: c.date, kind: "tag", text: `${c.author || "Someone"} tagged you on "${title}"`, project });
      });
      if (assignedTo(task, me) && inWindow(task.createdAt, window) && !closed.has(task.status || "")) {
        out.push({ at: task.createdAt, kind: "assigned", text: `You were assigned "${title}"`, project });
      }
    });
    // Tags on flow-map step items (questions / actions / notes).
    (pd.localResources || pd.resources || []).forEach((res: any) => {
      (res?.steps || []).forEach((step: any) => {
        (step?.items || []).forEach((it: any) => {
          if (lc(it?.author) === me || !(it?.mentions || []).some((m: any) => lc(m?.name) === me) || !inWindow(it.createdAt, window)) return;
          out.push({ at: it.createdAt, kind: "tag", text: `${it.author || "Someone"} tagged you on "${step.name || "a step"}" in ${res.name || "the flow map"}`, project });
        });
      });
    });
  });
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// Tags of this person they haven't checked, and tags they sent that someone hasn't checked. Open tasks only.
export function uncheckedFor(memberName: string, clients: DigestClient[], closedNames: string[] = ["Done"]): { mine: Unchecked[]; sent: Unchecked[] } {
  const me = lc(memberName);
  const closed = new Set(closedNames);
  const mine: Unchecked[] = [], sent: Unchecked[] = [];
  clients.forEach((client) => {
    const project = client.meta?.name || client.id;
    (client.project_data?.clientTasks || []).forEach((task: any) => {
      if (!task || closed.has(task.status || "")) return;
      const title = task.title || task.name || "a task";
      (task.comments || []).forEach((c: any) => {
        if (lc(c?.author) !== me && isMentioned(c, me) && !viewedBy(c, me)) {
          mine.push({ text: `${c.author || "Someone"} tagged you on "${title}"`, project, at: c.date });
        }
        if (lc(c?.author) === me) {
          const pending = (c.mentions || []).map((m: any) => m?.name).filter((n: any) => n && lc(n) !== me && !viewedBy(c, lc(n)));
          if (pending.length) sent.push({ text: `You tagged ${pending.join(", ")} on "${title}"`, project, at: c.date });
        }
      });
    });
  });
  const newest = (a: Unchecked, b: Unchecked) => Date.parse(b.at || "") - Date.parse(a.at || "");
  return { mine: mine.sort(newest).slice(0, MAX_UNCHECKED), sent: sent.sort(newest).slice(0, MAX_UNCHECKED) };
}

// ---------------------------------------------------------------------------------------------------------------------
// the message
// ---------------------------------------------------------------------------------------------------------------------
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clock = (iso: string, tz = DIGEST_TZ) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
const dayClock = (iso: string, tz = DIGEST_TZ) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz });

export type Digest = { subject: string; text: string; html: string; count: number };

// null when there is no new activity in either section (nothing is sent).
export function buildDigest(
  memberName: string,
  workday: DigestItem[],
  overnight: DigestItem[],
  unchecked: { mine: Unchecked[]; sent: Unchecked[] },
  w: Windows,
): Digest | null {
  const count = workday.length + overnight.length;
  if (!count) return null;
  const first = String(memberName || "").trim().split(/\s+/)[0] || "there";
  const subject = `Daily digest: ${count} update${count === 1 ? "" : "s"} (${new Date(`${w.digestDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })})`;

  const endLabel = `${w.endHour > 12 ? w.endHour - 12 : w.endHour}pm`;
  const weekend = w.endHour === FRIDAY_END;
  const sections: { title: string; sub: string; items: DigestItem[]; stamp: (iso: string) => string }[] = [
    { title: `${w.prevLabel}, 7am to ${endLabel}`, sub: "Previous workday", items: workday, stamp: clock },
    { title: `${endLabel} to 6:59am`, sub: weekend ? `After ${endLabel} Friday, through the weekend` : `Overnight, since ${endLabel} ${w.prevLabel.split(" ")[0]}`, items: overnight, stamp: dayClock },
  ];

  const text: string[] = [`Hi ${first},`, ""];
  const html: string[] = [`<p>Hi ${esc(first)},</p>`];
  sections.forEach((s) => {
    text.push(`${s.sub.toUpperCase()}: ${s.title}`);
    html.push(`<h3 style="margin:18px 0 4px;">${esc(s.sub)}</h3><div style="color:#666;font-size:12px;margin-bottom:6px;">${esc(s.title)}</div>`);
    if (!s.items.length) {
      text.push("  Nothing new.", "");
      html.push(`<p style="color:#888;margin:0;">Nothing new.</p>`);
      return;
    }
    html.push("<ul style=\"padding-left:18px;margin:0;\">");
    s.items.forEach((i) => {
      text.push(`  - ${s.stamp(i.at)}  ${i.text} (${i.project})`);
      html.push(`<li style="margin-bottom:4px;"><span style="color:#888;">${esc(s.stamp(i.at))}</span> ${esc(i.text)} <span style="color:#888;">(${esc(i.project)})</span></li>`);
    });
    html.push("</ul>");
    text.push("");
  });

  const block = (title: string, list: Unchecked[]) => {
    if (!list.length) return;
    text.push(title.toUpperCase());
    html.push(`<h3 style="margin:18px 0 4px;">${esc(title)}</h3><ul style="padding-left:18px;margin:0;">`);
    list.forEach((u) => {
      text.push(`  - ${u.text} (${u.project})`);
      html.push(`<li style="margin-bottom:4px;">${esc(u.text)} <span style="color:#888;">(${esc(u.project)})</span></li>`);
    });
    html.push("</ul>");
    text.push("");
  };
  block("Still unchecked: tags for you", unchecked.mine);
  block("Still unchecked: tags you sent", unchecked.sent);

  html.push(`<p style="color:#888;font-size:12px;margin-top:22px;">You can turn this digest off in Notification settings in the app.</p>`);
  text.push("You can turn this digest off in Notification settings in the app.");
  return { subject, text: text.join("\n"), html: html.join(""), count };
}
