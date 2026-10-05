//======================= CORE / SCHEDULING =======================//
// Per-day capacity and auto-slotting for task due dates. This is the real
// implementation of what was only ever shown as a Visualizer mockup earlier
// (a per-day grid of combined meeting + task hours, amber/red flagged) —
// nothing computed that number before this file. Pure functions: no
// database, no page.
//
// Capacity model (deliberately simple — "per-person capacity same for now"):
//   - One flat workday length and one flat capacity ratio for everyone,
//     not configurable per person yet.
//   - A day's load = synced calendar meeting time (all meetings weighted
//     equally, no required/optional distinction) + the estimated hours of
//     every task due that day for that assignee.
//   - Weekends are skipped when searching for a slot — a workday-hours
//     ceiling on a non-workday doesn't mean anything.
//
// Auto-slotting: walk forward from a start date (or today), day by day,
// skipping weekends, until a day is found whose load + this task's own
// estimate stays under the ceiling. If nothing fits within the push-out
// window, this returns no date at all — the caller's job is to then ask a
// human to pick manually, never to silently overbook someone.
import { taskAssignees, isGenericAssignee } from './task-assignees.js';
import { DEFAULT_OL_SETTINGS, getOlSettings } from './ol-settings.js';


export const WORKDAY_HOURS = 8;
export const CAPACITY_RATIO = 0.8;
export const MAX_DAILY_HOURS = WORKDAY_HOURS * CAPACITY_RATIO;   // 6.4 — no longer used for slotting; levels come from settings

// Tasks track loggedHours (worked, after the fact) but not an upfront
// estimate — this is the field that makes scheduling possible at all.
// Anything without one counts as this, rather than as zero load.
export const DEFAULT_TASK_ESTIMATE_HOURS = 1;

export function taskEstimatedHours(task) {
    const v = parseFloat(task?.estimatedHours);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_TASK_ESTIMATE_HOURS;
}

// Estimated hours from a fee: fee / feePerEstimatedHour (default $200 — sits under the billing rate, so it is a buffer).
// No fee (or the setting at 0) gives the default 1h.
export function estimateHoursFromFee(fee, cfg = DEFAULT_OL_SETTINGS.scheduling) {
    const per = Number(cfg?.feePerEstimatedHour);
    const f = Number(fee);
    if (!(per > 0) || !(f > 0)) return DEFAULT_TASK_ESTIMATE_HOURS;
    return Math.round((f / per) * 100) / 100;
}

const isWeekend = (date) => { const d = date.getDay(); return d === 0 || d === 6; };
// The calendar day in local time (an 8pm meeting is that day, not the next one in UTC).
const toDayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const fromDayKey = (key) => { const [y, m, d] = String(key).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

// Meeting hours for one assignee on one day, from synced calendar_events
// (assignee / assignees, start / end — see features/business/calendar.js).
// All meetings count equally; no required/optional weighting.
export function meetingHoursForDay(calendarEvents, assignee, dayKey) {
    if (!assignee) return 0;
    return (calendarEvents || []).reduce((sum, evt) => {
        if (!evt.start) return sum;
        const onAssignee = evt.assignee === assignee || (Array.isArray(evt.assignees) && evt.assignees.includes(assignee));
        if (!onAssignee) return sum;
        if (toDayKey(new Date(evt.start)) !== dayKey) return sum;
        const start = new Date(evt.start);
        const end = evt.end ? new Date(evt.end) : start;
        const hrs = Math.max(0, (end - start) / 3600000);
        return sum + hrs;
    }, 0);
}

// How a task's hours fall on days. A task estimated at or under the per-day cap is one chunk on its due date. A longer
// one is spread over working days, cap hours each, ending on its due date: the days the auto-scheduler chose
// (task.workSlots) when they still match the task, otherwise worked back from the due date.
function maxPerDay(cfg) {
    const m = Number((cfg || getOlSettings().scheduling)?.maxHoursPerDay);
    return m > 0 ? m : Infinity;
}

export function spreadBackFrom(dueKey, hours, cap) {
    const slots = [];
    let remaining = hours;
    let cursor = fromDayKey(dueKey);
    while (isWeekend(cursor)) cursor.setDate(cursor.getDate() - 1);
    for (let guard = 0; remaining > 0.001 && guard < 200; guard++) {
        const put = Math.min(cap, remaining);
        slots.unshift({ date: toDayKey(cursor), hours: Math.round(put * 100) / 100 });
        remaining -= put;
        do { cursor.setDate(cursor.getDate() - 1); } while (isWeekend(cursor));
    }
    return slots;
}

export function taskDaySlots(task, cfg) {
    const due = String(task?.dueDate || '').slice(0, 10);
    if (!due) return [];
    const hours = taskEstimatedHours(task);
    const cap = maxPerDay(cfg);
    if (!(hours > cap)) return [{ date: due, hours }];
    const saved = Array.isArray(task.workSlots) ? task.workSlots : [];
    const total = saved.reduce((sum, x) => sum + (Number(x.hours) || 0), 0);
    if (saved.length && saved[saved.length - 1].date === due && Math.abs(total - hours) < 0.01) return saved.map((x) => ({ date: String(x.date).slice(0, 10), hours: Number(x.hours) || 0 }));
    return spreadBackFrom(due, hours, cap);
}

// Queued task hours for one assignee on one day — every open task (not this one being scheduled) with hours on that
// day, counting only the part of a spread-out task that falls on it.
export function queuedTaskHoursForDay(tasks, assignee, dayKey, excludeTaskId, cfg) {
    if (!assignee) return 0;
    return (tasks || []).reduce((sum, t) => {
        if (!t || (excludeTaskId != null && t.id === excludeTaskId)) return sum;   // a row with no id (a task not saved yet) is never "the one being scheduled"
        if (!taskAssignees(t).includes(assignee)) return sum;   // a shared task loads every person on it
        const closed = t.status === 'Done' || t.status === 'Completed' || t.completed;
        if (closed) return sum;
        const onDay = taskDaySlots(t, cfg).filter((x) => x.date === dayKey).reduce((n, x) => n + x.hours, 0);
        return sum + onDay;
    }, 0);
}

// Combined load for one assignee on one day — the number the mockup
// visualized and the number auto-slotting checks against the ceiling.
export function dailyLoadHours(calendarEvents, tasks, assignee, dayKey, excludeTaskId) {
    return meetingHoursForDay(calendarEvents, assignee, dayKey) + queuedTaskHoursForDay(tasks, assignee, dayKey, excludeTaskId);
}

// ---- Priority levels (Green / Yellow / Red / Closed) ----
// A day's booked hours (meetings + tasks already due) put it in a level. The cut-offs are settings
// (core/ol-settings.js > scheduling), not constants:
//   Green  = under 3h        Yellow = 3h to 3:59      Red = 4h to 4:59      Closed (gray) = 5h or more
export const TIER_ORDER = ['green', 'yellow', 'red', 'closed'];
const tierIndex = (t) => Math.max(0, TIER_ORDER.indexOf(String(t || '').toLowerCase()));

export function loadTier(hours, cfg = DEFAULT_OL_SETTINGS.scheduling) {
    const h = Math.round((Number(hours) || 0) * 100) / 100;   // 2.999999h of float noise is not "under 3"
    if (h < cfg.greenUnderHours) return 'green';
    if (h < cfg.yellowUnderHours) return 'yellow';
    if (h < cfg.redUnderHours) return 'red';
    return 'closed';
}

// The fullest level a day may already be in for this client's status. The same limit applies on every day checked.
export function maxTierFor(clientStatus, cfg = DEFAULT_OL_SETTINGS.scheduling) {
    return (cfg.maxTierByStatus || {})[clientStatus] || cfg.maxTierDefault || 'green';
}

// Who is asked to place a task by hand when no day fits: the reviewer set in settings, else the person the task is
// assigned to (they approve their own), else the fallback. "Sphynx Task" / "Client Task" are buckets, not people.
export function reviewerFor(assignee, cfg = DEFAULT_OL_SETTINGS.scheduling) {
    if (String(cfg.reviewer || '').trim()) return String(cfg.reviewer).trim();
    if (assignee && !isGenericAssignee(assignee)) return String(assignee).trim();
    return String(cfg.fallbackReviewer || '').trim();
}

// Finds the working days, starting today (or startDate), within windowDays, for a task: each day used must have booked
// hours at or under the level this client's status may use (the same limit on every day checked; Closed days are never
// used). A task longer than maxHoursPerDay takes that many hours on each day it uses, skipping days that are too busy,
// and is due on the last of them.
// Returns { date: 'YYYY-MM-DD' (the day it finishes), slots: [{ date, hours }], loadHours, tier (of the first day) } on
// success, or { date: null, reason: 'no_capacity_in_window', reviewer } if it does not all fit — the caller hands off
// to a human at that point, never overbooks silently.
export function findFirstAvailableDate({ calendarEvents, tasks, assignee, estimatedHours, startDate, windowDays, excludeTaskId, clientStatus, config }) {
    const cfg = { ...DEFAULT_OL_SETTINGS.scheduling, ...(config || {}) };
    const span = Number.isFinite(windowDays) ? windowDays : (Number(cfg.windowDays) || 14);
    const limit = maxTierFor(clientStatus, cfg);
    const cap = maxPerDay(cfg);
    const hours = taskEstimatedHours({ estimatedHours });
    let remaining = hours;
    const slots = [];
    let first = null;
    let cursor = startDate ? new Date(startDate) : new Date();
    cursor.setHours(0, 0, 0, 0);

    for (let checked = 0; checked <= span; ) {
        if (!isWeekend(cursor)) {
            const dayKey = toDayKey(cursor);
            const load = dailyLoadHours(calendarEvents, tasks, assignee, dayKey, excludeTaskId);
            const tier = loadTier(load, cfg);
            if (tier !== 'closed' && tierIndex(tier) <= tierIndex(limit)) {
                const put = Math.min(cap, remaining);
                if (!first) first = { loadHours: load, tier };
                slots.push({ date: dayKey, hours: Math.round(put * 100) / 100 });
                remaining -= put;
                if (remaining <= 0.001) return { date: dayKey, slots, loadHours: first.loadHours, tier: first.tier };
            }
            checked++;
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    return { date: null, reason: 'no_capacity_in_window', reviewer: reviewerFor(assignee, cfg) };
}

// The label a caller can show for one day's load, from the same cut-offs: 'clear' (Green), 'amber' (Yellow),
// 'red' (Red), 'closed' (gray).
export function dayLoadTier(loadHours, cfg) {
    const t = loadTier(loadHours, cfg);
    return t === 'green' ? 'clear' : (t === 'yellow' ? 'amber' : t);
}
