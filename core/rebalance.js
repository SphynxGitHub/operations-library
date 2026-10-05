//======================= CORE / REBALANCE (ROLL-OVER) =======================//
// Once a person's total for a day (meetings + the hours of tasks on it) reaches their available hours (7h unless their
// profile sets otherwise; a day off is 0h, so its tasks all move),
// tasks on that day are moved later until it drops back under — meetings are never moved. Pure: it plans on copies and
// returns what to change; the caller writes it.
//
// Which tasks move, newest first (the "additional" ones), and only if they are safe to move:
//   - open, with a due date today or later, and a single named person (a shared task, or "Sphynx Task" / "Client Task", is left alone)
//   - not started (no logged time), and not waiting on a predecessor (dueRelativeTo)
// A moved task goes to the next day that fits by the SAME rules as the auto-scheduler (the client's allowed level, the
// per-day cap), so it is "the next day" unless that day is too busy for that client. A task spread over several days
// only has the days from the full one onward re-planned; the days before it stay put.
import { taskAssignees, isGenericAssignee } from './task-assignees.js';
import { dailyLoadHours, taskDaySlots, findFirstAvailableDate, memberDayHours } from './scheduling.js';

const localDate = (key) => { const [y, m, d] = String(key).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

const isClosed = (t) => t.status === 'Done' || t.status === 'Completed' || !!t.completed;

function isMovable(t, todayKey) {
    if (!t || t.id == null || isClosed(t) || t.dueRelativeTo) return false;
    if (!t.dueDate || String(t.dueDate).slice(0, 10) < todayKey) return false;
    if (Number(t.loggedHours) > 0) return false;
    const who = taskAssignees(t);
    return who.length === 1 && !isGenericAssignee(who[0]);
}

// events: synced meetings. entries: [{ clientId, clientStatus, task }]. Returns one record per task moved:
// { clientId, taskId, title, assignee, oldDueDate, newDueDate, newSlots, from }.
export function planRollovers({ events = [], entries = [], cfg, todayKey, maxMoves = 200 }) {
    const threshold = Number(cfg?.rollOverHours);
    if (!(threshold > 0)) return [];
    const work = entries.map((e) => ({ ...e, task: { ...e.task } }));
    const tasks = work.map((w) => w.task);
    const record = new Map();
    const stuck = new Set();
    let moves = 0;

    const persons = [...new Set(work.flatMap((w) => taskAssignees(w.task)).filter((n) => n && !isGenericAssignee(n)))];

    for (const person of persons) {
        const days = [...new Set(work
            .filter((w) => taskAssignees(w.task).includes(person))
            .flatMap((w) => taskDaySlots(w.task, cfg).map((s) => s.date))
            .filter((d) => d >= todayKey))].sort();

        for (const day of days) {
            for (let guard = 0; guard < 50; guard++) {
                const total = Math.round(dailyLoadHours(events, tasks, person, day) * 100) / 100;
                // The limit is this person's available hours that day (the standard 7h unless their profile says otherwise);
                // on a day off it is 0, so every task that can move does.
                const limit = memberDayHours(person, day, cfg);
                if (limit > 0 && total < limit) break;

                const candidates = work
                    .filter((w) => !stuck.has(String(w.task.id)) && isMovable(w.task, todayKey) && taskAssignees(w.task)[0] === person
                        && taskDaySlots(w.task, cfg).some((s) => s.date === day))
                    .sort((a, b) => String(b.task.createdAt || '').localeCompare(String(a.task.createdAt || '')));
                if (!candidates.length) break;

                const w = candidates[0];
                const t = w.task;
                const slots = taskDaySlots(t, cfg);
                const keep = slots.filter((s) => s.date < day);
                const remaining = slots.filter((s) => s.date >= day).reduce((n, s) => n + s.hours, 0);
                const start = localDate(day); start.setDate(start.getDate() + 1);
                const res = findFirstAvailableDate({ calendarEvents: events, tasks, assignee: person, estimatedHours: remaining, startDate: start, excludeTaskId: t.id, clientStatus: w.clientStatus, config: cfg });
                if (!res.date) { stuck.add(String(t.id)); continue; }   // nowhere to put it: leave it, try the next task

                const oldDueDate = record.get(String(t.id))?.oldDueDate || String(t.dueDate).slice(0, 10);
                const newSlots = [...keep, ...res.slots];
                t.dueDate = res.date;
                t.workSlots = newSlots;
                record.set(String(t.id), { clientId: w.clientId, taskId: t.id, title: t.title || t.name || 'Task', assignee: person, oldDueDate, newDueDate: res.date, newSlots, from: record.get(String(t.id))?.from || day });
                if (++moves >= maxMoves) return [...record.values()];
            }
        }
    }
    return [...record.values()];
}
