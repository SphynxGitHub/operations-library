//======================= CORE / STATUS HISTORY & KPIs =======================//
// Every change to a project's real status is logged on the project (meta.statusHistory: [{ from, to, at }]).
// From those logs: how many projects sit in each status now, how long projects typically stay in each, and
// how many that started in Discovery went on to become paying clients. Pure functions.

export const PAID_STATUSES = ['White Glove', 'Coaching', 'Ongoing Maintenance', 'Ad Hoc Maintenance'];

const validIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const daysBetween = (a, b) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 86400000);

// Records a change. A project with no history yet is first given its starting point (when it was created, if
// known), so its first stay is measured too.
export function recordStatusChange(meta, from, to, at = new Date().toISOString()) {
    if (!meta || from === to) return null;
    if (!Array.isArray(meta.statusHistory)) meta.statusHistory = [];
    if (!meta.statusHistory.length && from && validIso(meta.createdDate)) meta.statusHistory.push({ from: null, to: from, at: meta.createdDate });
    const entry = { from: from || null, to, at };
    meta.statusHistory.push(entry);
    return entry;
}

export function computeStatusKpis(clients, now = new Date().toISOString(), { windowDays = 30 } = {}) {
    const list = (clients || []).filter((c) => c && c.meta && c.meta.status !== 'Partner');
    const current = {};
    list.forEach((c) => { const s = c.meta.status || 'Unknown'; current[s] = (current[s] || 0) + 1; });

    const stays = {};                 // status -> [days]
    const transitions = {};           // "from → to" -> count
    let changesInWindow = 0;
    const cutoff = Date.parse(now) - windowDays * 86400000;
    const everDiscovery = new Set();
    const convertedFromDiscovery = new Set();

    list.forEach((c) => {
        const h = (c.meta.statusHistory || []).filter((e) => e && e.to && validIso(e.at)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        h.forEach((e, i) => {
            if (e.from) { const k = `${e.from} → ${e.to}`; transitions[k] = (transitions[k] || 0) + 1; }
            if (Date.parse(e.at) >= cutoff && e.from) changesInWindow++;
            const next = h[i + 1];
            if (next) (stays[e.to] = stays[e.to] || []).push(daysBetween(e.at, next.at));
            if (e.to === 'Discovery' || e.from === 'Discovery') everDiscovery.add(c.id);
            if (e.from === 'Discovery' && PAID_STATUSES.includes(e.to)) convertedFromDiscovery.add(c.id);
        });
        // a project still in Discovery today, with no history, still counts as having been in Discovery
        if (c.meta.status === 'Discovery') everDiscovery.add(c.id);
    });

    const averageDays = {};
    Object.entries(stays).forEach(([s, arr]) => { averageDays[s] = { days: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10, stays: arr.length }; });
    const discovery = everDiscovery.size;
    return {
        total: list.length, current, averageDays, transitions, changesInWindow, windowDays,
        discoveryConversion: { started: discovery, converted: convertedFromDiscovery.size, rate: discovery ? Math.round((convertedFromDiscovery.size / discovery) * 100) : null },
    };
}
