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

export const WORKDAY_HOURS = 8;
export const CAPACITY_RATIO = 0.8;
export const MAX_DAILY_HOURS = WORKDAY_HOURS * CAPACITY_RATIO;   // 6.4

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
        if (!t || t.id === excludeTaskId) return sum;
        if (t.assignee !== assignee) return sum;
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

// Finds the first day, starting today (or startDate), within windowDays,
// whose load plus this task's own estimate stays under the 80% ceiling.
// Returns { date: 'YYYY-MM-DD', loadHours } on success, or
// { date: null, reason: 'no_capacity_in_window' } if nothing fit — the
// caller hands off to a human at that point, never overbooks silently.
export function findFirstAvailableDate({ calendarEvents, tasks, assignee, estimatedHours, startDate, windowDays = 14, excludeTaskId }) {
    const estimate = Number.isFinite(estimatedHours) ? estimatedHours : DEFAULT_TASK_ESTIMATE_HOURS;
    let cursor = startDate ? new Date(startDate) : new Date();
    cursor.setHours(0, 0, 0, 0);

    for (let checked = 0; checked <= windowDays; ) {
        if (!isWeekend(cursor)) {
            const dayKey = toDayKey(cursor);
            const load = dailyLoadHours(calendarEvents, tasks, assignee, dayKey, excludeTaskId);
            if (load + estimate <= MAX_DAILY_HOURS) {
                return { date: dayKey, loadHours: load };
            }
            checked++;
        }
        cursor = new Date(cursor.getTime() + 86400000);
    }
    return { date: null, reason: 'no_capacity_in_window' };
}

// The status label a caller can show for one day's load — same tiers as
// the original mockup (amber at 4h, red past 5h) for a HUMAN-FACING nudge
// on the picker, distinct from the 6.4h hard ceiling auto-slotting uses.
// These stay two different numbers on purpose: 4h/5h flags a day as
// "getting busy" early enough for a person to notice and choose
// differently; the 6.4h ceiling is the actual "don't auto-place here"
// cutoff auto-slotting enforces. Conflating them would either make the
// visual warning fire too late to be useful, or make the auto-slot ceiling
// stricter than intended.
export function dayLoadTier(loadHours) {
    if (loadHours > 5) return 'red';
    if (loadHours >= 4) return 'amber';
    return 'clear';
}
