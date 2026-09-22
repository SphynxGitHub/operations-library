//======================= CORE / RECURRING TASKS =======================//
// A task can repeat: task.recurrence = { freq, interval }.
//   freq: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
//   interval: every N of those (default 1). "Every 2 weeks" = weekly/2,
//   quarterly = monthly/3.
// When a repeating task is closed, the next occurrence is created once
// (task.recurrenceNextId records it, so closing/reopening/closing never
// makes duplicates). The next due date counts from the closed task's due
// date — not from the day it was finished — so a series stays on schedule;
// if that date is already past, it rolls forward until it's today or later.
// Runs inside persist() for every client being saved, so it doesn't matter
// which screen (row, modal, bulk edit, board) closed the task.

import { state } from './data.js';

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
    return `Every ${rec.interval} ${rec.freq === 'daily' ? 'days' : rec.freq === 'weekly' ? 'weeks' : rec.freq === 'monthly' ? 'months' : rec.freq === 'yearly' ? 'years' : rec.freq}`;
}

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = String(k).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

function step(date, rec) {
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
        if (t.recurrence.until && String(t.recurrence.until) < today) { t.recurrenceNextId = 'ended'; return; }
        const nextId = 'tk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const due = nextDueDate(t.dueDate || today, t.recurrence, today);
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
            recurrence: { ...t.recurrence },
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
