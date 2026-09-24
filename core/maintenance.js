//======================= CORE / MAINTENANCE =======================//
// Maintenance for a client, on the client project JSON and as plain rows for the database tables. Pure functions.
//
//   Which clients: the pipeline label. "Ongoing Maintenance" clients have annual plan periods, an hours allotment, and
//   the Client Requests and Error Tracking tabs. "Ad Hoc Maintenance" clients have no periods: hours are bought as
//   needed and expire a year after purchase.
//   Plan period: one calendar year (start date to a due date a year later, less a day), with its hours allotment held
//   as an hours grant. At the end the unused hours can be extended as a courtesy carryover grant that expires 3 months
//   after the period ends, or 6 months if the client is renewing.
//   Client Requests: plain requests with no round, served first come first served. They are kept on a second
//   scoping sheet (kind "maintenance") so tasks, statuses, tags and the dashboard work for them as for any request.

export const MAINTENANCE_SHEET_ID = 'maintenance';
export const ONGOING = 'ongoing';
export const ADHOC = 'adhoc';

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

export function maintenanceMode(client) {
    const label = String(client?.meta?.status || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (label === 'ongoing maintenance') return ONGOING;
    if (label === 'ad hoc maintenance') return ADHOC;
    return null;
}
export const isOngoing = (client) => maintenanceMode(client) === ONGOING;
export const isMaintenanceClient = (client) => maintenanceMode(client) !== null;

export function maintenanceTabAllowed(client, key) {
    if (key === 'maintenance') return isMaintenanceClient(client);
    if (key === 'client-requests') return true;
    if (key === 'errors') return isOngoing(client) || client?.modules?.[key] === true;
    return true;
}

// ---- dates (YYYY-MM-DD strings; noon UTC so the day never shifts) ----
const parse = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
export const validDate = (iso) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
    const d = parse(iso);
    return !Number.isNaN(d.getTime()) && fmt(d) === String(iso);      // Feb 30 rolls into March, so it does not match
};
export const addDaysIso = (iso, n) => { const d = parse(iso); d.setUTCDate(d.getUTCDate() + Number(n)); return fmt(d); };
export function addMonthsIso(iso, n) {
    const d = parse(iso);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + Number(n));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate();
    d.setUTCDate(Math.min(day, last));                       // Nov 30 + 3 months is Feb 28, not March 2
    return fmt(d);
}
export const addYearsIso = (iso, n) => addMonthsIso(iso, Number(n) * 12);
export const daysBetween = (fromIso, toIso) => Math.round((parse(toIso) - parse(fromIso)) / 86400000);

// One calendar year: Sep 21 2026 runs to Sep 20 2027.
export const periodDue = (startIso) => addDaysIso(addYearsIso(startIso, 1), -1);
export const nextPeriodStart = (dueIso) => addDaysIso(dueIso, 1);
export const carryoverExpiry = (periodDueIso, renewing) => addMonthsIso(periodDueIso, renewing ? 6 : 3);
export const adHocExpiry = (purchasedIso) => addYearsIso(purchasedIso, 1);

export function periodProgress(period, todayIso) {
    const total = daysBetween(period.start_date, period.due_date) + 1;
    const elapsed = Math.min(Math.max(daysBetween(period.start_date, todayIso) + 1, 0), total);
    const left = daysBetween(todayIso, period.due_date);
    return { totalDays: total, elapsedDays: elapsed, daysLeft: left, pct: Math.round((elapsed / total) * 100), overdue: left < 0, notStarted: todayIso < period.start_date };
}

// ---- tiers: the standard plan sizes. A period stores the tier title it was sold as (column "tier"). ----
export const MAINTENANCE_TIERS = [
    { title: 'Tier 1', hours: 12 },
    { title: 'Tier 2', hours: 24 },
    { title: 'Tier 3', hours: 36 },
    { title: 'Tier 4', hours: 48 },
];
export const tierByTitle = (title) => MAINTENANCE_TIERS.find((t) => t.title === title) || null;
export const tierForHours = (hours) => MAINTENANCE_TIERS.find((t) => t.hours === Number(hours)) || null;
// The tier to show: the one saved on the period, or (for periods started before tiers existed) the one its hours match.
export const periodTierTitle = (period, allotHours) => (period?.tier || tierForHours(allotHours)?.title || '');
const cleanTier = (t) => (isBlank(t) ? null : String(t).trim());

// ---- time logged in a period, from the time entries on the client's tasks ----
// Each itemized time entry is dated by the day it ended (or started). Time logged before entries were itemized
// shows as one "earlier time" line dated by the task's completed or created date. Only billable time draws down
// the allotment; non-billable time is listed but not counted.
const dayOf = (v) => {
    if (isBlank(v)) return '';
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;       // the local day the work happened
};

// include(task): whether the task's time belongs here at all (client tasks don't).
// isBillable(task): whether its time counts against the allotment.
export function periodTimeEntries(tasks, period, { include = () => true, isBillable = () => false } = {}) {
    if (!period) return [];
    const inPeriod = (d) => !!d && d >= period.start_date && d <= period.due_date;
    const out = [];
    (tasks || []).forEach((t) => {
        if (!t || typeof t !== 'object' || !include(t)) return;
        const billable = !!isBillable(t);
        const base = { taskId: t.id, title: t.title || t.name || 'Untitled task', billable };
        const log = Array.isArray(t.timeLog) ? t.timeLog : [];
        let itemized = 0;
        log.forEach((e) => {
            const m = Number(e?.minutes) || 0;
            itemized += m;
            const day = dayOf(e?.end || e?.start);
            if (m && inPeriod(day)) out.push({ ...base, id: e.id || `${t.id}-${out.length}`, date: day, minutes: m, by: e.by || '', note: e.note || '', source: e.source || '' });
        });
        const earlier = Math.round((Number(t.loggedHours || t.hoursLogged || 0)) * 60) - itemized;
        const day = dayOf(t.completedAt || t.completedDate || t.createdAt || t.createdDate || t.date);
        if (earlier > 0 && inPeriod(day)) out.push({ ...base, id: `${t.id}-earlier`, date: day, minutes: earlier, by: '', note: 'Earlier time (not itemized)', source: 'earlier' });
    });
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

export function summarizePeriodTime(entries) {
    const min = (list) => list.reduce((s, e) => s + e.minutes, 0);
    const toH = (m) => Math.max(0, Math.round((m / 60) * 100) / 100);
    return { billableHours: toH(min(entries.filter((e) => e.billable))), nonBillableHours: toH(min(entries.filter((e) => !e.billable))) };
}

// Hours drawn from the allotment: billable time logged in the period.
export function hoursUsedInPeriod(tasks, period, opts = {}) {
    return summarizePeriodTime(periodTimeEntries(tasks, period, opts)).billableHours;
}

// ---- which grant each billable hour comes out of ----
// entries: from periodTimeEntries (only billable ones are charged). grants: hours_grant rows.
// allocations: { taskId: grantId } — tasks set aside for a specific grant (e.g. work identified before a period
// closed, to come out of its courtesy carryover).
//   1. Time on an allocated task comes out of that grant, when the entry falls inside the grant's dates (it can go
//      over; that shows as over).
//   2. Other time comes out of the plan allotment covering its date first, then, once that is used up, the other
//      grants covering the date, soonest to expire first. A carryover or purchase with tasks allocated to it is
//      held for those tasks and never takes other time.
//   3. Anything left over is charged to the first grant it could have used (showing as over), or, if no grant
//      covers the date, reported as unfunded.
// Entries are charged oldest first, so earlier work uses up hours first.
const gDay = (v) => String(v || '').slice(0, 10);
export const grantCovers = (g, day) => !!day && day >= gDay(g.granted_on) && day <= gDay(g.expires_on);
export const entryKey = (e) => `${e.taskId}|${e.id}`;

export function allocateHours({ entries = [], grants = [], allocations = {} }) {
    const cap = {}, used = {};
    grants.forEach((g) => { cap[g.id] = Math.round(Number(g.hours_granted || 0) * 60); used[g.id] = 0; });
    const byId = new Map(grants.map((g) => [String(g.id), g]));
    const reserved = new Set(Object.values(allocations).filter(Boolean).map(String)
        .filter((id) => byId.get(id) && byId.get(id).source !== 'plan_allotment'));
    const charges = {};
    let unfunded = 0;
    const charge = (key, g, minutes, over = false) => { used[g.id] += minutes; charges[key].push({ grantId: g.id, minutes, ...(over ? { over: true } : {}) }); };

    entries.filter((e) => e.billable).slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => {
        const key = entryKey(e);
        charges[key] = [];
        const pinned = byId.get(String(allocations[e.taskId] || ''));
        if (pinned && grantCovers(pinned, e.date)) {
            charge(key, pinned, e.minutes, used[pinned.id] + e.minutes > cap[pinned.id]);
            return;
        }
        const pool = grants.filter((g) => grantCovers(g, e.date) && g.status !== 'expired' && !reserved.has(String(g.id)))
            .sort((a, b) => (a.source === 'plan_allotment' ? 0 : 1) - (b.source === 'plan_allotment' ? 0 : 1) || gDay(a.expires_on).localeCompare(gDay(b.expires_on)));
        if (!pool.length) { unfunded += e.minutes; return; }
        if (e.minutes <= 0) { charge(key, pool[0], e.minutes); return; }      // a correction goes back where time goes
        let left = e.minutes;
        for (const g of pool) {
            const room = cap[g.id] - used[g.id];
            if (room <= 0) continue;
            const take = Math.min(room, left);
            charge(key, g, take);
            left -= take;
            if (!left) break;
        }
        if (left > 0) charge(key, pool[0], left, true);
    });
    return { usedMinutes: used, charges, unfundedMinutes: unfunded };
}

// ---- plans: the rows to write, worked out before anything is saved ----
const cleanHours = (v) => { const n = Math.round((parseFloat(v) || 0) * 100) / 100; return n > 0 ? n : 0; };

// Start a period. The allotment is held as a grant that expires when the period ends (none if the allotment is 0).
export function planStartPeriod({ clientId, start, allotment, renewing = false, tier = null }) {
    if (!validDate(start)) return { error: 'Enter a valid start date.' };
    const hours = cleanHours(allotment);
    const due = periodDue(start);
    const t = cleanTier(tier);
    return {
        period: { client_id: clientId, start_date: start, due_date: due, renewing: !!renewing, status: 'active', ...(t ? { tier: t } : {}) },
        grant: hours > 0 ? { client_id: clientId, source: 'plan_allotment', hours_granted: hours, granted_on: start, expires_on: due, status: 'active' } : null,
    };
}

// Change a period. The allotment grant follows the dates and hours; a carryover from this period follows its end date
// and whether the client is renewing (3 months, or 6) as long as its hours are unused (grants still "active").
export function planEditPeriod({ period, grants = [], patch }) {
    const start = patch.start_date ?? period.start_date;
    if (!validDate(start)) return { error: 'Enter a valid start date.' };
    const due = patch.due_date ?? (patch.start_date ? periodDue(start) : period.due_date);
    if (!validDate(due) || due <= start) return { error: 'The due date must be after the start date.' };
    const renewing = patch.renewing === undefined ? !!period.renewing : !!patch.renewing;
    const periodUpdate = { start_date: start, due_date: due, renewing };
    if (patch.tier !== undefined && cleanTier(patch.tier) !== cleanTier(period.tier)) periodUpdate.tier = cleanTier(patch.tier);   // only sent when it changes
    const grantUpdates = [];
    const allot = grants.find((g) => g.period_id === period.id && g.source === 'plan_allotment' && g.status === 'active');
    if (allot) {
        const p = { granted_on: start, expires_on: due };
        if (patch.allotment !== undefined) { const h = cleanHours(patch.allotment); if (h > 0) p.hours_granted = h; }
        grantUpdates.push({ id: allot.id, patch: p });
    }
    grants.filter((g) => g.period_id === period.id && g.source === 'courtesy_carryover' && g.status === 'active').forEach((g) => {
        grantUpdates.push({ id: g.id, patch: { expires_on: carryoverExpiry(due, renewing) } });
    });
    const newAllotment = !allot && patch.allotment !== undefined && cleanHours(patch.allotment) > 0
        ? { period_id: period.id, client_id: period.client_id, source: 'plan_allotment', hours_granted: cleanHours(patch.allotment), granted_on: start, expires_on: due, status: 'active' } : null;
    return { periodUpdate, grantUpdates, newAllotment };
}

// Close a period: optionally extend unused hours as a courtesy carryover, and optionally start the next year.
export function planClosePeriod({ period, carryoverHours = 0, renewNext = false, nextAllotment = 0, nextRenewing = false, nextTier = null, today }) {
    const out = { periodUpdate: { status: 'closed' }, carryover: null, next: null };
    const hours = cleanHours(carryoverHours);
    if (hours > 0) {
        out.carryover = { client_id: period.client_id, period_id: period.id, source: 'courtesy_carryover', hours_granted: hours,
                          granted_on: period.due_date, expires_on: carryoverExpiry(period.due_date, !!period.renewing), status: 'active',
                          note: `Courtesy carryover from the plan period ending ${period.due_date}` };
    }
    if (renewNext) out.next = planStartPeriod({ clientId: period.client_id, start: nextPeriodStart(period.due_date), allotment: nextAllotment, renewing: nextRenewing, tier: nextTier });
    return out;
}

// An ad hoc purchase: hours that expire a year after they are bought.
export function planAdHocPurchase({ clientId, hours, purchasedOn, note = '' }) {
    const h = cleanHours(hours);
    if (h <= 0) return { error: 'Enter the number of hours.' };
    if (!validDate(purchasedOn)) return { error: 'Enter a valid purchase date.' };
    return { grant: { client_id: clientId, source: 'ad_hoc_purchase', hours_granted: h, granted_on: purchasedOn, expires_on: adHocExpiry(purchasedOn), status: 'active', note: String(note || '').trim() || null } };
}

// Edit an ad hoc purchase or a courtesy carryover. (A plan allotment is edited through its plan period.)
export const GRANT_STATUSES = ['active', 'used_up', 'expired'];
export function planEditGrant({ grant, patch }) {
    if (!grant) return { error: 'That grant no longer exists. Reload and try again.' };
    if (grant.source === 'plan_allotment') return { error: 'Edit the plan period to change its allotment.' };
    const h = cleanHours(patch.hours ?? grant.hours_granted);
    if (h <= 0) return { error: 'Enter the number of hours.' };
    const granted = patch.granted_on ?? String(grant.granted_on).slice(0, 10);
    if (!validDate(granted)) return { error: grant.source === 'ad_hoc_purchase' ? 'Enter a valid purchase date.' : 'Enter a valid start date.' };
    const expires = patch.expires_on ?? String(grant.expires_on).slice(0, 10);
    if (!validDate(expires) || expires <= granted) return { error: 'The expiry date must be after the ' + (grant.source === 'ad_hoc_purchase' ? 'purchase date.' : 'start date.') };
    const status = patch.status ?? grant.status;
    if (!GRANT_STATUSES.includes(status)) return { error: 'Pick a status.' };
    const update = { hours_granted: h, granted_on: granted, expires_on: expires, status };
    if (patch.note !== undefined) update.note = String(patch.note || '').trim() || null;
    return { update };
}

// ---- Client Requests: plain requests kept on a second sheet ----
export function ensureMaintenanceSheet(pd) {
    if (!pd) return null;
    if (!Array.isArray(pd.scopingSheets)) pd.scopingSheets = [];
    let sheet = pd.scopingSheets.find((s) => s && s.id === MAINTENANCE_SHEET_ID);
    if (!sheet) {
        sheet = { id: MAINTENANCE_SHEET_ID, kind: 'maintenance', status: 'Approved', lineItems: [] };
        pd.scopingSheets.push(sheet);
    }
    if (!Array.isArray(sheet.lineItems)) sheet.lineItems = [];
    return sheet;
}
export const isMaintenanceSheet = (sheet) => !!sheet && (sheet.kind === 'maintenance' || sheet.id === MAINTENANCE_SHEET_ID);
export const maintenanceSheetOf = (pd) => (pd?.scopingSheets || []).find(isMaintenanceSheet) || null;

const SOURCES = ['email', 'portal', 'meeting', 'manual'];
export const REQUEST_SOURCES = [{ key: 'email', label: 'Email' }, { key: 'portal', label: 'Portal' }, { key: 'meeting', label: 'Meeting' }, { key: 'manual', label: 'Phone or other' }];

export function buildMaintenanceRequest(fields, { uid, now }) {
    const id = fields.id || ('mr-' + uid());
    const resourceIds = [...new Set((fields.resourceIds || []).filter((r) => !isBlank(r)).map(String))];
    return {
        id, name: String(fields.title || '').trim(), requestType: fields.requestType || 'revision',
        status: fields.status === 'Done' ? 'Done' : 'Do Now', responsibleParty: 'Sphynx', round: 1, teamMode: 'global', teamIds: [], data: {}, dependencies: [],
        resourceId: fields.resourceId || ('reqline-' + uid()), ...(resourceIds.length ? { resourceIds } : {}),
        source: SOURCES.includes(fields.source) ? fields.source : 'manual',
        reporter: String(fields.reporter || '').trim(), notes: String(fields.notes || '').trim(),
        receivedAt: validDate(fields.receivedAt) ? fields.receivedAt : String(now).slice(0, 10),
        manualHours: Math.max(0, parseFloat(fields.estimatedHours) || 0),
    };
}

// The queue: open requests oldest first (first come, first served), then the finished ones, newest first.
export function maintenanceRequests(pd) {
    const items = (maintenanceSheetOf(pd)?.lineItems || []).filter((i) => i && typeof i === 'object' && !isBlank(i.id));
    const at = (i) => `${i.receivedAt || '9999-99-99'}`;
    const open = items.filter((i) => String(i.status || '') !== 'Done' && !/^Don.t Do$/i.test(String(i.status || '')));
    const done = items.filter((i) => String(i.status || '') === 'Done');
    open.sort((a, b) => at(a).localeCompare(at(b)) || items.indexOf(a) - items.indexOf(b));
    done.sort((a, b) => String(b.doneAt || b.receivedAt || '').localeCompare(String(a.doneAt || a.receivedAt || '')));
    return { open, done };
}
export const requestAgeDays = (item, todayIso) => (validDate(item?.receivedAt) ? Math.max(0, daysBetween(item.receivedAt, todayIso)) : 0);
