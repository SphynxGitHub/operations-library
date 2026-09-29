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
import { DEFAULT_OL_SETTINGS } from './ol-settings.js';


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

const isWeekend = (date) => { const d = date.getDay(); return d === 0 || d === 6; };
const toDayKey = (date) => date.toISOString().slice(0, 10);

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

// Queued task hours for one assignee on one day — every open task (not
// this one being scheduled) already due that day.
export function queuedTaskHoursForDay(tasks, assignee, dayKey, excludeTaskId) {
    if (!assignee) return 0;
    return (tasks || []).reduce((sum, t) => {
        if (!t || (excludeTaskId != null && t.id === excludeTaskId)) return sum;   // a row with no id (a task not saved yet) is never "the one being scheduled"
        if (!taskAssignees(t).includes(assignee)) return sum;   // a shared task loads every person on it
        if ((t.dueDate || '').slice(0, 10) !== dayKey) return sum;
        const closed = t.status === 'Done' || t.status === 'Completed' || t.completed;
        if (closed) return sum;
        return sum + taskEstimatedHours(t);
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

// Finds the first working day, starting today (or startDate), within windowDays, whose booked hours put it at or
// under the level this client's status may use — the same limit on every day checked. Closed days are never used.
// Returns { date: 'YYYY-MM-DD', loadHours, tier } on success, or { date: null, reason: 'no_capacity_in_window',
// reviewer } if nothing fit — the caller hands off to a human at that point, never overbooks silently.
export function findFirstAvailableDate({ calendarEvents, tasks, assignee, estimatedHours, startDate, windowDays, excludeTaskId, clientStatus, config }) {
    const cfg = { ...DEFAULT_OL_SETTINGS.scheduling, ...(config || {}) };
    const span = Number.isFinite(windowDays) ? windowDays : (Number(cfg.windowDays) || 14);
    const limit = maxTierFor(clientStatus, cfg);
    let cursor = startDate ? new Date(startDate) : new Date();
    cursor.setHours(0, 0, 0, 0);

    for (let checked = 0; checked <= span; ) {
        if (!isWeekend(cursor)) {
            const dayKey = toDayKey(cursor);
            const load = dailyLoadHours(calendarEvents, tasks, assignee, dayKey, excludeTaskId);
            const tier = loadTier(load, cfg);
            if (tier !== 'closed' && tierIndex(tier) <= tierIndex(limit)) {
                return { date: dayKey, loadHours: load, tier };
            }
            checked++;
        }
        cursor = new Date(cursor.getTime() + 86400000);
    }
    return { date: null, reason: 'no_capacity_in_window', reviewer: reviewerFor(assignee, cfg) };
}

// The label a caller can show for one day's load, from the same cut-offs: 'clear' (Green), 'amber' (Yellow),
// 'red' (Red), 'closed' (gray).
export function dayLoadTier(loadHours, cfg) {
    const t = loadTier(loadHours, cfg);
    return t === 'green' ? 'clear' : (t === 'yellow' ? 'amber' : t);
}
