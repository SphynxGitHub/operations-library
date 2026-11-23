//======================= CORE / RECURRING TASKS =======================//
// A task can repeat: task.recurrence = { freq, interval }.
//   freq: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
//   interval: every N of those (default 1).
//   Optional: until ('YYYY-MM-DD'), count (total occurrences, counting the first), days (array of 0-6, Sun-Sat) with
//   dayMode ('include' = only these days, 'exclude' = never these days). "Every 2 weeks" = weekly/2,
//   quarterly = monthly/3.
// When a repeating task is closed, the next occurrence is created once
// (task.recurrenceNextId records it, so closing/reopening/closing never
// makes duplicates). The next due date counts from the closed task's due
// date — not from the day it was finished — so a series stays on schedule;
// if that date is already past, it rolls forward until it's today or later.
// Runs inside persist() for every client being saved, so it doesn't matter
// which screen (row, modal, bulk edit, board) closed the task.

import { state } from './data.js';
import { nextAvailableDayKey } from './scheduling.js';

export const RECURRENCE_PRESETS = {
    '': { label: 'Does not repeat' },
    daily: { label: 'Daily', freq: 'daily', interval: 1 },
    weekdays: { label: 'Every weekday (Mon–Fri)', freq: 'weekdays', interval: 1 },
    weekly: { label: 'Weekly', freq: 'weekly', interval: 1 },
    biweekly: { label: 'Every 2 weeks', freq: 'weekly', interval: 2 },
    monthly: { label: 'Monthly', freq: 'monthly', interval: 1 },
    quarterly: { label: 'Quarterly', freq: 'monthly', interval: 3 },
    yearly: { label: 'Yearly', freq: 'yearly', interval: 1 }
};

export function recurrencePresetKey(rec) {
    if (!rec || !rec.freq) return '';
    if (rec.until || rec.count || (rec.days && rec.days.length)) return 'custom'; // an end, a count or a day filter makes it custom
    const n = Number(rec.interval) || 1;
    for (const [k, p] of Object.entries(RECURRENCE_PRESETS)) {
        if (p.freq === rec.freq && (p.interval || 1) === n) return k;
    }
    return 'custom';
}

export function describeRecurrence(rec) {
    const key = recurrencePresetKey(rec);
    if (key === '') return '';
    if (key !== 'custom') return RECURRENCE_PRESETS[key].label;
    const n = Number(rec.interval) || 1;
    const units = { daily: 'day', weekdays: 'weekday', weekly: 'week', monthly: 'month', yearly: 'year' };
    const unit = units[rec.freq] || rec.freq;
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayPart = rec.days && rec.days.length ? ` ${rec.dayMode === 'exclude' ? 'except' : 'on'} ${[...rec.days].sort((x, y) => x - y).map((d) => names[d]).join(', ')}` : '';
    const endPart = rec.count ? `, ${rec.count} times` : rec.until ? ` until ${String(rec.until).slice(0, 10)}` : '';
    return `Every ${n === 1 ? '' : n + ' '}${unit}${n === 1 ? '' : 's'}${dayPart}${endPart}`;
}

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = String(k).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

// Days of the week (0-6) an occurrence may fall on, or null when there is no filter.
function allowedDays(rec) {
    if (!rec.days || !rec.days.length) return null;
    const set = new Set(rec.days.map(Number));
    if (rec.dayMode === 'exclude') return new Set([0, 1, 2, 3, 4, 5, 6].filter((d) => !set.has(d)));
    return set;
}

function baseStep(date, rec) {
    const n = Math.max(1, Number(rec.interval) || 1);
    const d = new Date(date);
    if (rec.freq === 'daily') d.setDate(d.getDate() + n);
    else if (rec.freq === 'weekdays') {
        let left = n;
        while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left--; }
    }
    else if (rec.freq === 'weekly') d.setDate(d.getDate() + 7 * n);
    else if (rec.freq === 'monthly') {
        const day = d.getDate();
        d.setDate(1); d.setMonth(d.getMonth() + n);
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, last)); // Jan 31 -> Feb 28, not Mar 3
    }
    else if (rec.freq === 'yearly') d.setFullYear(d.getFullYear() + n);
    else d.setDate(d.getDate() + 7 * n);
    return d;
}

function step(date, rec) {
    const allowed = allowedDays(rec);
    if (!allowed) return baseStep(date, rec);
    if (!allowed.size) throw new Error('Recurring task: every day of the week is excluded, so there is no valid next date.');
    const n = Math.max(1, Number(rec.interval) || 1);
    if (rec.freq === 'weekly' && rec.dayMode !== 'exclude') {
        // "Weekly on Mon and Wed": the next chosen day later this week, else the first chosen day N weeks on.
        const sorted = [...allowed].sort((x, y) => x - y);
        const d = new Date(date);
        const later = sorted.find((x) => x > d.getDay());
        if (later !== undefined) { d.setDate(d.getDate() + (later - d.getDay())); return d; }
        d.setDate(d.getDate() - d.getDay() + 7 * n + sorted[0]);
        return d;
    }
    // Any other cadence: take the normal step, then slide forward to the next allowed day.
    const d = baseStep(date, rec);
    let guard = 0;
    while (!allowed.has(d.getDay()) && guard++ < 7) d.setDate(d.getDate() + 1);
    return d;
}

export function nextDueDate(fromDueKey, rec, todayKey) {
    let d = step(fromKey(fromDueKey || todayKey), rec);
    let guard = 0;
    while (toKey(d) < todayKey && guard++ < 500) d = step(d, rec);
    return toKey(d);
}

const statuses = () => (window.OL?.getSystemStatuses ? window.OL.getSystemStatuses() : (state.master?.taskStatuses || []));

function closedNames() {
    const names = statuses().filter((s) => s.isClosed).map((s) => s.name);
    return new Set([...names, 'Done', 'Completed']);
}

// Returns the number of occurrences created.
export function spawnRecurringTasksFor(client) {
    const tasks = client?.projectData?.clientTasks;
    if (!Array.isArray(tasks) || !tasks.length) return 0;
    const closed = closedNames();
    const today = toKey(new Date());
    const created = [];

    tasks.forEach((t) => {
        if (!t?.recurrence?.freq || t.recurrenceNextId || !closed.has(t.status)) return;
        // Monthly hours check-in: no next one while the plan has expired and the client is not renewing (see checkInWanted).
        if (t.recurrenceTag === 'monthly-touch-base' && client?.projectData?.maintenanceSetup?.checkInPaused) { t.recurrenceNextId = 'ended'; return; }
        if (t.recurrence.until && String(t.recurrence.until) < today) { t.recurrenceNextId = 'ended'; return; }
        const index = Number(t.recurrenceIndex) || 1;
        if (Number(t.recurrence.count) > 0 && index >= Number(t.recurrence.count)) { t.recurrenceNextId = 'ended'; return; }
        const nextId = 'tk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const due = nextAvailableDayKey(t, nextDueDate(t.dueDate || today, t.recurrence, today));   // never on a day the assignee is off
        if (t.recurrence.until && due > String(t.recurrence.until)) { t.recurrenceNextId = 'ended'; return; }
        const firstStatus = statuses().find((s) => !s.isClosed)?.name || 'Pending Sphynx Action';
        created.push({
            id: nextId,
            title: t.title || t.name, name: t.title || t.name,
            description: t.description || '', descriptionHtml: t.descriptionHtml || '',
            assignee: t.assignee, isClientTask: t.isClientTask,
            status: firstStatus,
            dueDate: due,
            requestLineItemId: t.requestLineItemId || null,
            parentResourceId: t.parentResourceId || null,
            resourceName: t.resourceName, category: t.category,
            howToIds: [...(t.howToIds || [])],
            dependencies: [],
            // manual billable choices carry over; rules re-evaluate anyway
            ...(t.billable === true || t.billable === false ? { billable: t.billable } : {}),
            ...(t.recurrenceTag ? { recurrenceTag: t.recurrenceTag } : {}),
            recurrence: { ...t.recurrence, ...(t.recurrence.days ? { days: [...t.recurrence.days] } : {}) },
            recurrenceIndex: index + 1,
            recurrenceSeriesId: t.recurrenceSeriesId || t.id,
            recurrencePrevId: t.id,
            loggedHours: 0,
            comments: [],
            createdAt: new Date().toISOString()
        });
        t.recurrenceNextId = nextId;
    });

    if (created.length) tasks.unshift(...created);
    return created.length;
}

window.OL = window.OL || {};
Object.assign(window.OL, { RECURRENCE_PRESETS, recurrencePresetKey, describeRecurrence, nextRecurrenceDueDate: nextDueDate, spawnRecurringTasksFor });
