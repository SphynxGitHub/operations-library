//======================= CORE / DASHBOARD MODULES =======================//
// The numbers behind the optional modules on the global dashboard. Pure functions on the loaded clients, so each one
// can be checked on its own. A client that is only partly loaded (no projectData) is skipped.
//
// Modules: availability (today or the week), pending review, leads waiting on scoping, client follow-ups due,
// waiting on client by age, hours blocks nearing their limits, reviews ending soon.

import { isTaskClosed } from './work-status.js';

export const MODULES = [
    { key: 'availability',   label: 'Availability',             icon: 'calendar-days', team: true  },
    { key: 'pending_review', label: 'Pending client review',    icon: 'send',          team: true  },
    { key: 'leads',          label: 'Leads waiting on scoping', icon: 'user-plus',     team: true  },
    { key: 'follow_ups',     label: 'Client follow-ups due',    icon: 'bell',          team: false },
    { key: 'waiting_age',    label: 'Waiting on client by age', icon: 'hourglass',     team: true  },
    { key: 'hours_blocks',   label: 'Hours blocks nearing limits', icon: 'timer',      team: false },
    { key: 'reviews_ending', label: 'Reviews ending soon',      icon: 'calendar-clock', team: true },
];
export const DEFAULT_ON = ['availability', 'pending_review', 'leads'];
export const TEAM_PRESET = MODULES.filter((m) => m.team).map((m) => m.key);

const loaded = (clients) => (clients || []).filter((c) => c && c.projectData && !c._metaOnly);
const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : '');
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const nameOf = (c) => c.meta?.name || 'Project';
const closedList = (names) => (names && names.length ? names : ['Done']);

// ---- availability ------------------------------------------------------------------------------------------------
// Monday to Friday of the week that holds `anchorDay` (YYYY-MM-DD), moved by weekOffset weeks.
export function weekDays(anchorDay, weekOffset = 0) {
    const d = new Date(`${anchorDay}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7;                       // Monday = 0
    d.setUTCDate(d.getUTCDate() - dow + weekOffset * 7);
    return Array.from({ length: 5 }, (_, i) => { const x = new Date(d); x.setUTCDate(d.getUTCDate() + i); return x.toISOString().slice(0, 10); });
}

// people: names. capacityFor(name, day) -> hours available; loadFor(name, day) -> hours already spoken for.
// Returns [{ name, days: [{ day, free }], total }]. free is never below 0.
export function availabilityGrid({ people, days, capacityFor, loadFor }) {
    return (people || []).map((name) => {
        const cells = days.map((day) => ({ day, free: Math.max(0, Math.round(((Number(capacityFor(name, day)) || 0) - (Number(loadFor(name, day)) || 0)) * 10) / 10) }));
        return { name, days: cells, total: Math.round(cells.reduce((s, c) => s + c.free, 0) * 10) / 10 };
    });
}

// ---- pending client review ---------------------------------------------------------------------------------------
// reviews: rows from the reviews table with status 'sent'; itemsByReview: review id -> review_items rows.
export function pendingReviewRollup({ reviews, itemsByReview, clientsById, today }) {
    return (reviews || []).filter((r) => r.status === 'sent').map((r) => {
        const open = (itemsByReview?.[r.id] || []).filter((i) => i.outcome === 'pending').length;
        return { reviewId: r.id, clientId: r.client_id, client: clientsById?.[r.client_id]?.meta?.name || 'Project', open, sentBy: r.sent_by || '',
                 followUpOwner: r.follow_up_owner || '', day: dayOf(r.sent_at), age: r.sent_at ? Math.max(0, daysBetween(dayOf(r.sent_at), today)) : null };
    }).filter((x) => x.open > 0).sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
}

// Closed tasks not in any review for minDays or more.
export function readyNotSent({ clients, reviewedTaskIds, closedNames, today, minDays = 3 }) {
    const out = [];
    loaded(clients).forEach((c) => {
        const names = closedList(closedNames);
        const items = (c.projectData.clientTasks || []).filter((t) => t && !t.consolidatedFollowUp && isTaskClosed(t, names) && t.status !== 'Approved'
            && t.completedAt && !reviewedTaskIds?.has(`${c.id}:${t.id}`) && daysBetween(dayOf(t.completedAt), today) >= minDays && daysBetween(dayOf(t.completedAt), today) <= 30);
        if (items.length) out.push({ clientId: c.id, client: nameOf(c), count: items.length, age: Math.max(...items.map((t) => daysBetween(dayOf(t.completedAt), today))) });
    });
    return out.sort((a, b) => b.age - a.age);
}

// ---- leads waiting on scoping ------------------------------------------------------------------------------------
// Pre-client projects (Discovery) with something owed. "us" = a lead task is open; "client" = the quote went out and the
// sheet is in Drafting.
export function leadsWaiting({ clients, closedNames, today, roundStatusOf }) {
    const names = closedList(closedNames);
    const out = [];
    loaded(clients).filter((c) => c.meta?.status === 'Discovery').forEach((c) => {
        const open = (c.projectData.clientTasks || []).filter((t) => t && t.leadTaskKind && !isTaskClosed(t, names));
        if (open.length) {
            const t = open.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0];
            out.push({ clientId: c.id, client: nameOf(c), waitingOn: 'us', what: t.leadTaskKind === 'prepare_quote' ? 'Prepare quote' : 'Offer paid scoping',
                       age: t.createdAt ? Math.max(0, daysBetween(dayOf(t.createdAt), today)) : 0, late: !!(t.dueDate && t.dueDate < today) });
            return;
        }
        const drafting = (c.projectData.scopingSheets || []).some((s) => s && s.kind !== 'maintenance' && s.id !== 'maintenance'
            && [...new Set((s.lineItems || []).map((i) => i && i.round).filter((r) => r !== undefined && r !== null && r !== ''))].some((r) => roundStatusOf(s, String(r)) === 'Drafting'));
        if (drafting) out.push({ clientId: c.id, client: nameOf(c), waitingOn: 'client', what: 'Quote in Drafting', age: 0, late: false });
    });
    return out.sort((a, b) => (a.waitingOn === b.waitingOn ? b.age - a.age : a.waitingOn === 'us' ? -1 : 1));
}

// ---- client follow-ups due ---------------------------------------------------------------------------------------
export function followUpsDue({ clients, closedNames, today, withinDays = 5 }) {
    const names = closedList(closedNames);
    const out = [];
    loaded(clients).forEach((c) => {
        const t = (c.projectData.clientTasks || []).find((x) => x && x.consolidatedFollowUp && !isTaskClosed(x, names));
        if (!t || !t.dueDate) return;
        const due = dayOf(t.dueDate);
        if (daysBetween(today, due) > withinDays) return;
        out.push({ clientId: c.id, client: nameOf(c), owner: t.assignee || '', due, overdueDays: due < today ? daysBetween(due, today) : 0 });
    });
    return out.sort((a, b) => a.due.localeCompare(b.due));
}

// ---- waiting on client by age ------------------------------------------------------------------------------------
export function waitingByAge({ clients, closedNames, today, isClientWaiting, minDays = 3 }) {
    const names = closedList(closedNames);
    const out = [];
    loaded(clients).forEach((c) => {
        const waiting = (c.projectData.clientTasks || []).filter((t) => t && !t.consolidatedFollowUp && !isTaskClosed(t, names) && isClientWaiting(t.status) && (t.statusChangedAt || t.createdAt));
        const ages = waiting.map((t) => Math.max(0, daysBetween(dayOf(t.statusChangedAt || t.createdAt), today))).filter((a) => a >= minDays);
        if (ages.length) out.push({ clientId: c.id, client: nameOf(c), count: ages.length, oldest: Math.max(...ages) });
    });
    return out.sort((a, b) => b.oldest - a.oldest);
}

// ---- hours blocks nearing limits ---------------------------------------------------------------------------------
// The open 80 / 90 / 95 / 100% reminder tasks (made by core/client-work-rules.js) are the record of a block that needs
// attention, so this lists them.
export function hoursBlocksNearing({ clients, closedNames }) {
    const names = closedList(closedNames);
    const out = [];
    loaded(clients).forEach((c) => {
        (c.projectData.clientTasks || []).filter((t) => t && t.createdBy === 'maintenance' && !isTaskClosed(t, names)
            && /(\d+)% of (?:plan|prepaid) hours used|hours used up/i.test(String(t.title || ''))).forEach((t) => {
            const m = /(\d+)% of/i.exec(t.title || '');
            out.push({ clientId: c.id, client: nameOf(c), pct: m ? Number(m[1]) : 100, taskId: t.id });
        });
    });
    return out.sort((a, b) => b.pct - a.pct);
}

// ---- reviews ending soon -----------------------------------------------------------------------------------------
export function reviewsEnding({ clients, today, withinDays = 7 }) {
    const out = [];
    loaded(clients).forEach((c) => {
        Object.values(c.projectData.roundStates || {}).forEach((st) => {
            if (!st || st.status !== 'in_review' || !st.reviewEnd) return;
            const left = daysBetween(today, dayOf(st.reviewEnd));
            if (left > withinDays) return;
            out.push({ clientId: c.id, client: nameOf(c), round: st.round, ends: dayOf(st.reviewEnd), daysLeft: left });
        });
    });
    return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
