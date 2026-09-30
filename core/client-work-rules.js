//======================= CORE / CLIENT WORK RULES =======================//
// Rules that keep client-waiting work and follow-ups moving, run before each save (same place as
// updateTestRuns / updateRoundStates — see core/data.js persist()). Every pass is idempotent: it looks at
// what already exists and only adds or changes what's missing, so running it on every save is safe.
//
//   1. Implementation tasks waiting on the client. Client tasks alone change nothing on an implementation task,
//      and neither does a Dependency (features/dependencies.js) on one — those are informational (see
//      openClientTasksFor below, used to display them). The implementer decides whether they can keep working,
//      and says so ONLY by changing the task's status to a "Pending Client ..." status (Action, Feedback,
//      Document or Review). That flip is what logs the due date and removes it, and records the client tasks
//      open at that moment (by request/resource AND anything set as a Dependency). When ALL of them are
//      complete, the task goes back to "Pending Sphynx Action" and gets a date again: the original date if
//      that isn't in the past, otherwise the day after the last one was completed. A task left on Pending
//      Sphynx Action is never touched by this, no matter what it depends on.
//   2. One consolidated client follow-up task per project (not per task or round): lists everything open on
//      the client, request by request and resource by resource. It closes when nothing is open and reopens
//      with the same history when something new arrives. When a PERSON marks it done, it stays done until the
//      next follow-up is due (every N days, task.nextFollowUpDue), then comes back if items are still open.
//      Deleting it does the same (project.followUpSnoozeUntil) instead of the rule just making a new one.
//   3. Stale implementation tasks (no status change for 10+ days) get a "status note" task for the
//      implementer, due a day before the next follow-up; its latest comment appears on the follow-up as a
//      "status to share" line.
//   4. Quarterly check-in after a round closes (four quarters, or until the client converts to Ongoing
//      Maintenance).
//   5. Ongoing Maintenance: a setup task and a monthly touch base when a client becomes Ongoing Maintenance,
//      and a prompt to propose a brainstorming meeting after 60 days with no new requests.
//   6. A working round left in Drafting too long (setting: Automations > Templates & settings): a task to follow up
//      with the client or change the round's status to record the outcome. Repeats until the round leaves Drafting.
//
// Pure functions on the client project JSON. ctx: { roles, closedNames, sphynxNames, today (YYYY-MM-DD),
// now (ISO), uid, followUpEveryDays, staleDays, isOngoing(client) }.

import { linksForTask, addLink } from './task-links.js';
import { isTaskClosed, isClientWaitingStatus, isThirdPartyWaitingStatus } from './work-status.js';
import { isClientFacing } from './request-tasks.js';
import { isRoundApproved, isActiveItem, getCurrentRound, roundStatusOf } from './requests.js';
import { isOngoing } from './maintenance.js';
import { state, uid } from './data.js';
import { getOlSettings, fillTemplate } from './ol-settings.js';

export const BLOCKED_STATUS = 'Pending Client Action';   // the default waiting status; any "Pending Client ..." status counts
export const OPEN_STATUS = 'Pending Sphynx Action';
export const FOLLOW_UP_STATUS = 'Needs Follow Up';
export const DEFAULT_FOLLOW_UP_EVERY_DAYS = 3;
export const DEFAULT_STALE_DAYS = 10;
export const INACTIVITY_DAYS = 60;

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const day = (v) => String(v || '').slice(0, 10);
const parse = (iso) => new Date(`${day(iso)}T12:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = parse(iso); d.setUTCDate(d.getUTCDate() + Number(n)); return fmt(d); };
export const addMonths = (iso, n) => {
    const d = parse(iso); const dom = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + Number(n));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dom, last));
    return fmt(d);
};
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

const closedList = (ctx) => (ctx.closedNames && ctx.closedNames.length ? ctx.closedNames : ['Done']);
const isOpen = (t, ctx) => !!t && !isTaskClosed(t, closedList(ctx));

function communicationAssignee(client, ctx) {
    const role = (ctx.roles || []).find((r) => /communicat/i.test(String(r?.name || '')));
    const a = role ? (client?.projectData?.roleAssignments || []).find((x) => x.roleId === role.id) : null;
    return (a && a.memberName) || 'Sphynx Task';
}

const requestsOf = (client) => (client?.projectData?.scopingSheets || []).flatMap((s) => (s?.lineItems || []));
const requestById = (client, id) => requestsOf(client).find((i) => i && String(i.id) === String(id)) || null;

// A request's own round is "active for follow-up" only while its round is Drafting or Approved — On Hold and
// Declined rounds don't chase the client for anything. Backlog items (no round yet) aren't active either.
function requestIsFollowUpEligible(client, item) {
    if (!item || isBlank(item.round)) return false;
    const sheet = (client?.projectData?.scopingSheets || []).find((sh) => sh && (sh.lineItems || []).some((i) => i === item));
    if (!sheet) return false;
    return ['Drafting', 'Approved'].includes(roundStatusOf(sheet, item.round));
}
const requestTitle = (client, item) => (item && !isBlank(item.name) ? String(item.name).trim() : 'Request');
const resourceName = (client, id) => {
    const r = (client?.projectData?.localResources || []).find((x) => String(x.id) === String(id));
    return r?.name || '';
};

// Implementation work = Sphynx's own steps: not something asked of the client / a third party, and not a
// housekeeping task the rules themselves create.
const isImplementationTask = (t, ctx) => !!t && !t.isClientTask && !t.askKind && !t.consolidatedFollowUp && !t.statusNoteFor
    && !t.recurrenceTag && !t.testRunId && !t.reviewNotifyKey && !t.reviewFollowUpKey && linksForTask(t).length > 0
    && !isClientFacing(t, ctx);

// ------------------------------------------------------------------------------------------
// 1. Blocked implementation tasks
// ------------------------------------------------------------------------------------------

// The open client-facing tasks that hold up an implementation task: same request, and — when the
// implementation task is scoped to particular resources — asks for those resources or for the request as a
// whole.
export function relatedClientTasks(client, task, ctx) {
    const tasks = client?.projectData?.clientTasks || [];
    const mine = linksForTask(task);
    return tasks.filter((t) => {
        if (!t || t.id === task.id || !isOpen(t, ctx) || !isClientFacing(t, ctx)) return false;
        return linksForTask(t).some((theirs) => mine.some((m) => {
            if (m.requestId !== theirs.requestId) return false;
            const mr = m.resourceIds || [], tr = theirs.resourceIds || [];
            if (!mr.length || !tr.length) return true;
            return mr.some((id) => tr.includes(id));
        }));
    });
}

// Every open client-ask task connected to an implementation task — by request/resource (the normal, automatic
// link) or by an explicit Dependency (features/dependencies.js). This is what the Tasks view nests underneath
// an implementation task, and what a task's own "Waiting on" comes from once it IS flipped to a Pending Client
// status (see reconcileBlockedTasks). Purely a lookup — it never changes anything.
export function openClientTasksFor(client, task, ctx) {
    const byRequest = relatedClientTasks(client, task, ctx);
    const byDependency = dependencyClientTasks(client, task, ctx);
    const seen = new Set();
    return [...byRequest, ...byDependency].filter((t) => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
}


const localDay = (iso) => day(iso);

// Where a released task's date goes: its original date, unless that has passed; then the day after the last
// client task was completed (never earlier than today).
export function restoreDueDate(original, latestCompletedDay, today) {
    if (!isBlank(original) && day(original) >= today) return day(original);
    const after = isBlank(latestCompletedDay) ? today : addDays(latestCompletedDay, 1);
    return after < today ? today : after;
}

// The open client-ask tasks a task is blocked by (a Dependency of kind 'task' pointing at a client-facing,
// still-open task). Anything else in blockedBy (another implementation task, a request, a resource) is a plain
// sequencing dependency and isn't part of this. Informational only — see the header note above.
export function dependencyClientTasks(client, task, ctx) {
    const all = client?.projectData?.clientTasks || [];
    return (task.blockedBy || [])
        .filter((d) => d && d.kind === 'task')
        .map((d) => all.find((t) => t && String(t.id) === String(d.id)))
        .filter((t) => t && isClientFacing(t, ctx) && isOpen(t, ctx));
}

const addComment = (task, text, ctx) => {
    (task.comments = task.comments || []).push({ id: ctx.uid(), author: 'System', text, html: '', mentions: [], date: ctx.now });
};

export function reconcileBlockedTasks(client, ctx) {
    const out = { blocked: [], released: [] };
    const all = client?.projectData?.clientTasks || [];
    all.forEach((t) => {
        if (!t || !isImplementationTask(t, ctx)) return;
        const depTasks = dependencyClientTasks(client, t, ctx);
        const waiting = isClientWaitingStatus(t.status);

        if (waiting && !t.blockedOn) {
            // Just set to a client-waiting status (by hand or via a Dependency): log the due date, remove it,
            // note what it is waiting for.
            const related = [...new Set([...relatedClientTasks(client, t, ctx).map((x) => x.id), ...depTasks.map((x) => x.id)])];
            t.blockedOn = { since: ctx.now, status: t.status, dueDate: day(t.dueDate), taskIds: related, completed: {} };
            (t.dueDateLog = t.dueDateLog || []).push({ at: ctx.now, event: 'removed', dueDate: day(t.dueDate), status: t.status });
            if (!isBlank(t.dueDate)) addComment(t, `Due date ${day(t.dueDate)} removed while waiting on the client (${t.status}). It comes back when the related client tasks are complete.`, ctx);
            t.dueDate = '';
            out.blocked.push(t.id);
        } else if (waiting && t.blockedOn) {
            // Keep the list current: client tasks added after the flip, by request/resource or by Dependency,
            // are part of what it is waiting for.
            const b = t.blockedOn;
            [...relatedClientTasks(client, t, ctx), ...depTasks].forEach((x) => { if (!b.taskIds.includes(x.id)) b.taskIds.push(x.id); });
            // Note when each one was completed, for the restored date.
            b.taskIds.forEach((id) => {
                const c = all.find((x) => x.id === id);
                if (c && !isOpen(c, ctx) && !b.completed[id]) b.completed[id] = day(c.completedAt || ctx.now);
            });
            const done = b.taskIds.length > 0 && b.taskIds.every((id) => { const c = all.find((x) => x.id === id); return !c || !isOpen(c, ctx); });
            if (done) {
                const latest = Object.values(b.completed).sort().pop() || '';
                t.status = OPEN_STATUS;
                t.dueDate = restoreDueDate(b.dueDate, latest, ctx.today);
                (t.dueDateLog = t.dueDateLog || []).push({ at: ctx.now, event: 'restored', dueDate: t.dueDate });
                addComment(t, `All the related client tasks are complete. Back to ${OPEN_STATUS}${t.dueDate ? `, due ${t.dueDate}` : ''}.`, ctx);
                delete t.blockedOn;
                out.released.push(t.id);
            }
        } else if (!waiting && t.blockedOn) {
            // The implementer moved it out of the waiting status themselves: give the date back.
            if (isBlank(t.dueDate)) {
                t.dueDate = restoreDueDate(t.blockedOn.dueDate, '', ctx.today);
                (t.dueDateLog = t.dueDateLog || []).push({ at: ctx.now, event: 'restored', dueDate: t.dueDate });
            }
            delete t.blockedOn;
            out.released.push(t.id);
        }
    });
    return out;
}

// ------------------------------------------------------------------------------------------
// 2 + 3. Consolidated client follow-up, and status notes for stale work
// ------------------------------------------------------------------------------------------

// When each task's status last changed. Tasks seen for the first time start their clock now, so turning this
// on doesn't flag every old task as stale at once.
export function stampStatusChanges(client, ctx) {
    (client?.projectData?.clientTasks || []).forEach((t) => {
        if (!t) return;
        if (t.statusSeen === undefined) { t.statusSeen = t.status || ''; if (!t.statusChangedAt) t.statusChangedAt = ctx.now; return; }
        if (t.statusSeen !== (t.status || '')) { t.statusSeen = t.status || ''; t.statusChangedAt = ctx.now; }
    });
}

// Open client-facing tasks grouped request -> resource.
export function openClientItems(client, ctx) {
    const groups = new Map();
    (client?.projectData?.clientTasks || []).forEach((t) => {
        if (!t || !isOpen(t, ctx) || !isClientFacing(t, ctx) || t.consolidatedFollowUp) return;
        // A client task not tied to any request (e.g. added directly) still counts: it goes in an "Other" group.
        const links = linksForTask(t);
        if (!links.length) {
            if (!groups.has('_unlinked')) groups.set('_unlinked', { title: 'Other client tasks', resources: new Map() });
            const g = groups.get('_unlinked');
            if (!g.resources.has('')) g.resources.set('', { name: '', tasks: [] });
            g.resources.get('').tasks.push(t);
            return;
        }
        links.forEach((l) => {
            const item = l.requestId ? requestById(client, l.requestId) : null;
            if (!item) return;
            if (['Done', "Don't Do", 'Backlog'].includes(String(item.status || ''))) return;
            if (!requestIsFollowUpEligible(client, item)) return;   // On Hold / Declined rounds don't chase the client
            const reqKey = l.requestId;
            if (!groups.has(reqKey)) groups.set(reqKey, { title: requestTitle(client, item), resources: new Map() });
            const g = groups.get(reqKey);
            const resKeys = (l.resourceIds && l.resourceIds.length) ? l.resourceIds : [''];
            resKeys.forEach((rid) => {
                if (!g.resources.has(rid)) g.resources.set(rid, { name: rid ? resourceName(client, rid) : '', tasks: [] });
                g.resources.get(rid).tasks.push(t);
            });
        });
    });
    return groups;
}

function staleTasks(client, ctx) {
    const days = ctx.staleDays || DEFAULT_STALE_DAYS;
    return (client?.projectData?.clientTasks || []).filter((t) => t && isImplementationTask(t, ctx) && isOpen(t, ctx)
        && !isClientWaitingStatus(t.status) && t.statusChangedAt && daysBetween(day(t.statusChangedAt), ctx.today) >= days);
}

function lastCommentText(task) {
    const list = (task?.comments || []).filter((c) => c && !isBlank(c.text));
    return list.length ? String(list[list.length - 1].text).trim() : '';
}

function followUpDescription(client, groups, notes) {
    const lines = ['Waiting on the client:'];
    groups.forEach((g) => {
        lines.push('', `${g.title}`);
        g.resources.forEach((r) => {
            if (r.name) lines.push(`  ${r.name}`);
            r.tasks.forEach((t) => lines.push(`    - ${t.title || t.name}`));   // client tasks have no due dates of their own
        });
    });
    if (notes.length) {
        lines.push('', 'Status to share:');
        notes.forEach((n) => lines.push(`  - ${n.title}: ${n.text}`));
    }
    return lines.join('\n');
}

export function reconcileClientFollowUp(client, ctx) {
    const out = { created: [], reopened: [], closed: [], notePrompts: [] };
    const pd = client?.projectData;
    if (!pd) return out;
    if (!Array.isArray(pd.clientTasks)) pd.clientTasks = [];
    const every = ctx.followUpEveryDays || DEFAULT_FOLLOW_UP_EVERY_DAYS;
    const closed = closedList(ctx);

    const groups = openClientItems(client, ctx);
    const needed = groups.size > 0;
    let fu = pd.clientTasks.find((t) => t && t.consolidatedFollowUp);
    const nextDue = addDays(ctx.today, every);

    // ---- status notes for stale work ----
    const stale = staleTasks(client, ctx);
    const staleIds = new Set(stale.map((t) => t.id));
    pd.clientTasks.filter((t) => t && t.statusNoteFor && isOpen(t, ctx)).forEach((p) => {
        const target = pd.clientTasks.find((x) => x.id === p.statusNoteFor);
        if (!target || !isOpen(target, ctx) || !staleIds.has(target.id)) { p.status = closed[0]; p.cancelledAt = ctx.now; }   // it moved on: no note needed
    });
    const noteDue = (() => { const d = addDays(fu && isOpen(fu, ctx) && fu.dueDate ? day(fu.dueDate) : nextDue, -1); return d < ctx.today ? ctx.today : d; })();
    stale.forEach((t) => {
        const existing = pd.clientTasks.find((p) => p && p.statusNoteFor === t.id && isOpen(p, ctx));
        if (existing) return;
        if (t.statusNoteAt && daysBetween(day(t.statusNoteAt), ctx.today) < (ctx.staleDays || DEFAULT_STALE_DAYS)) return;   // already asked recently
        // Stalled waiting on a third party: the status-note prompt goes to whoever handles third-party
        // follow-up (Anthony), not the task's own assignee — they're often waiting on a vendor, not sitting on
        // it themselves. Stalled on Sphynx's own side still prompts the task's assignee, as before.
        const thirdParty = isThirdPartyWaitingStatus(t.status);
        const promptAssignee = thirdParty ? (ctx.thirdPartyStatusNoteAssignee || 'Anthony') : (t.assignee || null);
        const p = {
            id: ctx.uid(), title: `Status note: ${t.title || t.name}`, name: `Status note: ${t.title || t.name}`,
            description: `This has had no status change for ${daysBetween(day(t.statusChangedAt), ctx.today)} days${thirdParty ? ' — it\'s waiting on a third party' : ''}. Add a comment with a short update the client can be told, then mark this Done. It will be included in the next client follow-up.`,
            status: OPEN_STATUS, assignee: promptAssignee, dueDate: noteDue, isClientTask: false, loggedHours: 0, parentTaskId: null,
            createdBy: 'followup', createdAt: ctx.now, statusNoteFor: t.id, links: [],
        };
        linksForTask(t).forEach((l) => addLink(p, l.requestId, l.resourceIds || []));
        pd.clientTasks.unshift(p);
        out.notePrompts.push(p.id);
    });
    // Notes that were written (prompt task done with a comment) for tasks still open and stale feed the follow-up.
    const notes = [];
    pd.clientTasks.filter((p) => p && p.statusNoteFor).forEach((p) => {
        const target = pd.clientTasks.find((x) => x.id === p.statusNoteFor);
        if (!target || !isOpen(target, ctx)) return;
        const text = lastCommentText(p);
        if (text) notes.push({ title: target.title || target.name, text });
        if (!isOpen(p, ctx) && !p.cancelledAt) target.statusNoteAt = day(p.completedAt || ctx.now);
    });

    // ---- the consolidated follow-up itself ----
    if (!needed) {
        if (fu && isOpen(fu, ctx)) {
            fu.status = closed[0]; fu.completedAt = ctx.now; fu.autoClosed = true;
            (fu.followUpLog = fu.followUpLog || []).push({ at: ctx.now, event: 'closed', note: 'Nothing waiting on the client.' });
            out.closed.push(fu.id);
        }
        return out;
    }

    // A person marked the touchpoint done (or deleted the task): it stays out of the way until the next follow-up is
    // due, rather than coming straight back. The wait rides on the closed task (nextFollowUpDue) or, for a deleted
    // one, on the project (followUpSnoozeUntil). Re-opening it by hand ends the wait. A follow-up the RULE closed
    // (nothing was waiting) is not parked: it reopens as soon as something new arrives.
    if (fu && isOpen(fu, ctx)) delete fu.nextFollowUpDue;
    let parkedUntil = '';
    if (fu && !isOpen(fu, ctx) && !fu.autoClosed) {
        if (!fu.nextFollowUpDue) {
            fu.nextFollowUpDue = addDays(day(fu.completedAt) || ctx.today, every);
            (fu.followUpLog = fu.followUpLog || []).push({ at: fu.completedAt || ctx.now, event: 'touchpoint done', note: `Next follow-up ${fu.nextFollowUpDue}.` });
        }
        parkedUntil = fu.nextFollowUpDue;
    }
    if (pd.followUpSnoozeUntil && pd.followUpSnoozeUntil > parkedUntil) parkedUntil = pd.followUpSnoozeUntil;
    if (parkedUntil && ctx.today < parkedUntil) return out;      // still waiting for the next follow-up date
    const wasParked = !!parkedUntil;
    delete pd.followUpSnoozeUntil;
    const dueNow = wasParked ? ctx.today : nextDue;              // coming back on its date means it is due today

    const description = followUpDescription(client, groups, notes);
    if (!fu) {
        fu = {
            id: ctx.uid(), title: `Client follow-up: ${client.meta?.name || 'client'}`, name: `Client follow-up: ${client.meta?.name || 'client'}`,
            description, status: FOLLOW_UP_STATUS, assignee: communicationAssignee(client, ctx), dueDate: dueNow,
            isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'followup', createdAt: ctx.now,
            askKind: 'follow_up', consolidatedFollowUp: true, followUpLog: [{ at: ctx.now, event: 'created' }], links: [],
        };
        pd.clientTasks.unshift(fu);
        out.created.push(fu.id);
    } else if (!isOpen(fu, ctx)) {
        // Closed by the rule (it was empty) or its wait is over: more is waiting, so it comes back.
        fu.followUpLog = fu.followUpLog || [];
        if (fu.autoClosed) fu.followUpLog.push({ at: fu.completedAt || ctx.now, event: 'closed' });
        fu.followUpLog.push({ at: ctx.now, event: 'reopened' });
        fu.status = FOLLOW_UP_STATUS; fu.completedAt = ''; fu.autoClosed = false; fu.dueDate = dueNow; fu.description = description;
        delete fu.nextFollowUpDue;
        out.reopened.push(fu.id);
    } else if (fu.description !== description) {
        fu.description = description;
    }
    return out;
}

// ------------------------------------------------------------------------------------------
// 4. Quarterly check-in after a round closes
// ------------------------------------------------------------------------------------------

const unapprovedRounds = (client) => {
    const rounds = new Set();
    (client?.projectData?.scopingSheets || []).forEach((sheet) => {
        if (!sheet || sheet.kind === 'maintenance' || sheet.id === 'maintenance') return;
        (sheet.lineItems || []).forEach((i) => {
            if (!i || ['Done', "Don't Do", 'Backlog'].includes(String(i.status || ''))) return;
            const r = Math.max(1, parseInt(i.round, 10) || 1);
            if (!isRoundApproved(sheet, r)) rounds.add(r);
        });
    });
    return [...rounds].sort((a, b) => a - b);
};

export function quarterlyCheckInText(client) {
    const rounds = unapprovedRounds(client);
    return rounds.length
        ? `Check in with the client about the next round of work. ${rounds.length === 1 ? `Round ${rounds[0]} is` : `Rounds ${rounds.join(', ')} are`} scoped but not yet approved.`
        : 'No further rounds are scoped. Check in on the client\'s ongoing maintenance needs.';
}

// Called when a round's review closes. Four quarters: the first is due in three months; each time one is closed
// the next appears (core/recurrence.js), up to twelve months out.
export function createQuarterlyCheckIn(client, ctx) {
    const pd = client?.projectData;
    if (!pd || (ctx.isOngoing && ctx.isOngoing(client))) return null;
    if (!Array.isArray(pd.clientTasks)) pd.clientTasks = [];
    if (pd.clientTasks.some((t) => t && t.recurrenceTag === 'quarterly-check-in')) return null;   // one series at a time
    const t = {
        id: ctx.uid(), title: `Quarterly check-in: ${client.meta?.name || 'client'}`, name: `Quarterly check-in: ${client.meta?.name || 'client'}`,
        description: quarterlyCheckInText(client), status: OPEN_STATUS, assignee: communicationAssignee(client, ctx),
        dueDate: addMonths(ctx.today, 3), isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'conclusion', createdAt: ctx.now,
        recurrenceTag: 'quarterly-check-in', recurrence: { freq: 'monthly', interval: 3, until: addMonths(ctx.today, 12) },
    };
    pd.clientTasks.unshift(t);
    return t;
}

// Keeps open quarterly check-ins current, and retires them once the client is on Ongoing Maintenance.
export function reconcileQuarterlyCheckIns(client, ctx) {
    (client?.projectData?.clientTasks || []).forEach((t) => {
        if (!t || t.recurrenceTag !== 'quarterly-check-in') return;
        if (ctx.isOngoing && ctx.isOngoing(client)) {
            if (isOpen(t, ctx)) { t.status = closedList(ctx)[0]; t.completedAt = ctx.now; t.cancelledAt = ctx.now; }
            if (!t.recurrenceNextId) t.recurrenceNextId = 'ended';
            return;
        }
        if (isOpen(t, ctx)) { const text = quarterlyCheckInText(client); if (t.description !== text) t.description = text; }
    });
}

// ------------------------------------------------------------------------------------------
// 5. Ongoing Maintenance touch-points
// ------------------------------------------------------------------------------------------

const requestDates = (client) => {
    const dates = [];
    requestsOf(client).forEach((i) => { const d = day(i?.receivedAt || i?.createdAt || i?.addedAt); if (d.length === 10) dates.push(d); });
    (client?.projectData?.clientRequests || []).forEach((i) => { const d = day(i?.receivedAt || i?.createdAt); if (d.length === 10) dates.push(d); });
    return dates;
};

export function reconcileMaintenance(client, ctx) {
    const out = { created: [] };
    const pd = client?.projectData;
    if (!pd || !ctx.isOngoing || !ctx.isOngoing(client)) return out;
    if (!Array.isArray(pd.clientTasks)) pd.clientTasks = [];
    // A client who was already on Ongoing Maintenance before this existed is marked without a setup task
    // (it's long since set up); one who has just converted (ctx.justConverted) gets it.
    if (!pd.maintenanceSetup) {
        pd.maintenanceSetup = { at: ctx.today };
        if (!ctx.justConverted) pd.maintenanceSetup.setupTaskId = 'existing';
    }
    const setup = pd.maintenanceSetup;
    const who = communicationAssignee(client, ctx);
    const make = (fields) => {
        const t = { id: ctx.uid(), status: OPEN_STATUS, assignee: who, isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'maintenance', createdAt: ctx.now, ...fields };
        t.name = t.title;
        pd.clientTasks.unshift(t); out.created.push(t.id); return t;
    };

    if (!setup.setupTaskId) {
        setup.setupTaskId = make({
            title: `Set up Ongoing Maintenance: ${client.meta?.name || 'client'}`, dueDate: addDays(ctx.today, 3),
            description: 'Start the plan period and confirm the hours tier (Maintenance & Hours). Check that error reports reach this project: the project ID or tracking sheet ID is set for the Zaps, and errors arrive in Error Tracking.',
        }).id;
    }
    if (!setup.touchBaseTaskId) {
        setup.touchBaseTaskId = make({
            title: `Monthly hours check-in: ${client.meta?.name || 'client'}`, dueDate: addMonths(ctx.today, 1),
            description: 'Review the hours used against the plan (Maintenance & Hours), log any time still missing, and send the client a short update.',
            recurrenceTag: 'monthly-touch-base', recurrence: { freq: 'monthly', interval: 1 },
        }).id;
    }

    // 60 days without a new request: prompt once per quiet stretch. A new request moves the last date forward,
    // which starts the count again.
    // The last request date; a client with no dated requests at all counts from when these rules started.
    const dates = requestDates(client).sort();
    const last = dates.length ? dates[dates.length - 1] : day(setup.at);
    if (last && daysBetween(last, ctx.today) >= INACTIVITY_DAYS && setup.inactivityFor !== last) {
        make({
            title: `No requests in ${INACTIVITY_DAYS} days: ${client.meta?.name || 'client'}`, dueDate: addDays(ctx.today, 2),
            description: `No new request since ${last}. Propose a brainstorming meeting, or send the client an Opportunities list.`,
        });
        setup.inactivityFor = last;
    }
    return out;
}

// Reminders as a plan period nears its end. periods come from the database (maintenance_plan_period), not the
// project JSON, so the caller passes them in. One reminder per period per date.
export function planPeriodReminders(client, periods, ctx) {
    const pd = client?.projectData;
    if (!pd || !ctx.isOngoing || !ctx.isOngoing(client)) return [];
    const setup = pd.maintenanceSetup = pd.maintenanceSetup || { at: ctx.today };
    setup.reminders = setup.reminders || {};
    const created = [];
    (periods || []).filter((p) => p && p.status === 'active' && p.due_date).forEach((p) => {
        const due = day(p.due_date);
        [[60, 'Plan period ends in 2 months'], [14, 'Plan period ends in 2 weeks']].forEach(([lead, label]) => {
            const key = `${p.id}:${lead}`;
            if (setup.reminders[key]) return;
            const when = addDays(due, -lead);
            if (when < addDays(ctx.today, -lead)) { setup.reminders[key] = 'skipped'; return; }   // too late to matter
            const t = {
                id: ctx.uid(), title: `${label}: ${client.meta?.name || 'client'}`, name: `${label}: ${client.meta?.name || 'client'}`,
                description: `The current plan period ends ${due}. Talk to the client about renewing, and decide whether to give any unused hours as a courtesy carryover.`,
                status: OPEN_STATUS, assignee: communicationAssignee(client, ctx), dueDate: when < ctx.today ? ctx.today : when,
                isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'maintenance', createdAt: ctx.now,
            };
            pd.clientTasks.unshift(t); setup.reminders[key] = t.id; created.push(t.id);
        });
    });
    return created;
}

// ------------------------------------------------------------------------------------------
// 6. Working rounds left in Drafting
// ------------------------------------------------------------------------------------------
// A round is "in Drafting" from its statusChangedAt (stamped when the round is created or its status changes; a round
// that has none yet starts its clock the first time this runs). After afterDays a task is made for the project's
// Communications person (or the assignee set in settings). It is not made again while that task is open, and only
// again after repeatEveryDays once it has been closed. Approving, declining or holding the round stops it.
const roundLabel = (round) => (/^\d+$/.test(String(round)) ? `Working Round ${round}` : String(round));

function reconcileDraftingRounds(client, ctx) {
    const cfg = ctx.drafting;
    const created = [];
    if (!cfg || cfg.enabled === false) return created;
    const afterDays = Math.max(1, Number(cfg.afterDays) || 7);
    const repeatDays = Math.max(1, Number(cfg.repeatEveryDays) || afterDays);
    const pd = client.projectData;
    (pd.scopingSheets || []).forEach((sheet) => {
        if (!sheet || sheet.kind === 'maintenance' || sheet.id === 'maintenance') return;
        const rounds = new Set((sheet.lineItems || []).filter((i) => i && !isBlank(i.round)).map((i) => String(i.round)));
        rounds.forEach((round) => {
            if (roundStatusOf(sheet, round) !== 'Drafting') return;
            let entry = sheet.roundApprovals?.[round];
            let since = day(entry?.statusChangedAt || (entry ? '' : sheet.statusChangedAt));
            if (!since) {
                if (!sheet.roundApprovals) sheet.roundApprovals = {};
                if (!entry) entry = sheet.roundApprovals[round] = { status: 'Drafting' };
                entry.statusChangedAt = ctx.now;   // start the clock
                since = day(ctx.now);
            }
            const age = daysBetween(since, ctx.today);
            if (age < afterDays) return;

            const key = `${sheet.id || 'sheet'}:${round}`;
            const mine = pd.clientTasks.filter((t) => t && t.draftingFollowUpKey === key);
            if (mine.some((t) => isOpen(t, ctx))) return;
            const last = mine.map((t) => day(t.createdAt)).sort().pop();
            if (last && daysBetween(last, ctx.today) < repeatDays) return;

            const vars = { round: roundLabel(round), client: client.meta?.name || 'client', days: age };
            const title = fillTemplate(cfg.taskTitle, vars) || `Follow up on ${vars.round}`;
            const t = {
                id: ctx.uid(), title, name: title,
                description: fillTemplate(cfg.taskDescription, vars),
                status: OPEN_STATUS, assignee: (cfg.assignee || '').trim() || communicationAssignee(client, ctx), dueDate: ctx.today,
                isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'drafting-followup', createdAt: ctx.now,
                draftingFollowUpKey: key,
            };
            pd.clientTasks.unshift(t); created.push(t.id);
        });
    });
    return created;
}

// ------------------------------------------------------------------------------------------
// the pass
// ------------------------------------------------------------------------------------------
export function runClientWorkRules(client, ctx) {
    if (!client?.projectData) return null;
    if (!Array.isArray(client.projectData.clientTasks)) client.projectData.clientTasks = [];
    stampStatusChanges(client, ctx);
    const blocked = reconcileBlockedTasks(client, ctx);
    const followUp = reconcileClientFollowUp(client, ctx);
    reconcileQuarterlyCheckIns(client, ctx);
    const maintenance = reconcileMaintenance(client, ctx);
    const drafting = reconcileDraftingRounds(client, ctx);
    return { blocked, followUp, maintenance, drafting };
}

// ------------------------------------------------------------------------------------------
// wiring: build the context from app state, expose on window.OL (run from persist(), like recurrence.js)
// ------------------------------------------------------------------------------------------
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function ensureBlockedStatus() {
    // An org that saved its own status list needs the new status added to it; the built-in list already has it.
    const list = state.master?.taskStatuses;
    if (Array.isArray(list) && list.length && !list.some((s) => s.name === BLOCKED_STATUS)) {
        list.splice(Math.min(1, list.length), 0, { id: 'st-blocked-client', name: BLOCKED_STATUS, color: '#0880ea', isClosed: false });
    }
}

function contextNow(extra = {}) {
    ensureBlockedStatus();
    const statuses = window.OL?.getSystemStatuses ? window.OL.getSystemStatuses() : (state.master?.taskStatuses || []);
    const closed = statuses.filter((s) => s.isClosed).map((s) => s.name);
    return {
        roles: state.master?.roles || [], closedNames: closed.length ? closed : ['Done'],
        sphynxNames: (state.master?.sphynxTeam || []).map((m) => m.name).filter(Boolean),
        today: localToday(), now: new Date().toISOString(), uid,
        followUpEveryDays: Number(state.master?.followUpEveryDays) || DEFAULT_FOLLOW_UP_EVERY_DAYS,
        staleDays: Number(state.master?.staleDays) || DEFAULT_STALE_DAYS,
        thirdPartyStatusNoteAssignee: state.master?.thirdPartyStatusNoteAssignee || 'Anthony',
        drafting: getOlSettings().draftingFollowUp,
        isOngoing, ...extra,
    };
}

export function runClientWorkRulesFor(client) { return runClientWorkRules(client, contextNow()); }

// The follow-up task was deleted: don't make a new one until the next follow-up would have been due.
export function snoozeClientFollowUp(client) {
    const ctx = contextNow();
    if (!client?.projectData) return '';
    client.projectData.followUpSnoozeUntil = addDays(ctx.today, ctx.followUpEveryDays || DEFAULT_FOLLOW_UP_EVERY_DAYS);
    return client.projectData.followUpSnoozeUntil;
}
export function onClientBecameOngoing(client) {
    const ctx = contextNow({ justConverted: true });
    reconcileQuarterlyCheckIns(client, ctx);
    return reconcileMaintenance(client, ctx);
}
export function createQuarterlyCheckInFor(client) { return createQuarterlyCheckIn(client, contextNow()); }
export function syncPeriodReminders(clientId, periods) {
    const client = state.clients?.[clientId];
    if (!client) return [];
    const created = planPeriodReminders(client, periods, contextNow());
    if (created.length && window.OL?.markClientDirty) { window.OL.markClientDirty(clientId); window.OL.persist?.(); }
    return created;
}

// The rules above run when a client is saved. Time-based ones (60 days with no requests, work that has gone
// stale, plan-period reminders) must also run for a client nobody has touched, so this goes through every loaded
// client shortly after the app opens and every few hours after that. Team logins only. A client is saved only if
// something actually changed.
let sweeping = false;
export async function sweepClientWorkRules() {
    if (sweeping || window.IS_GUEST || !(state.adminMode === true || state.teamMemberMode === true)) return { checked: 0, changed: 0 };
    sweeping = true;
    const out = { checked: 0, changed: 0 };
    try {
        for (const client of Object.values(state.clients || {})) {
            if (!client || client._metaOnly || !client.projectData || client.meta?.status === 'Partner') continue;
            out.checked++;
            const snap = () => JSON.stringify([client.projectData.clientTasks, client.projectData.maintenanceSetup, client.projectData.followUpSnoozeUntil, (client.projectData.scopingSheets || []).map((sh) => sh?.roundApprovals)]);
            const before = snap();
            try {
                // Ongoing Maintenance: read the plan periods so the two reminders before a period ends exist even
                // if nobody opens Maintenance & Hours (loadMaintenanceData makes them).
                if (isOngoing(client) && typeof window.OL?.loadMaintenanceData === 'function') await window.OL.loadMaintenanceData(client.id);
                runClientWorkRules(client, contextNow());
            } catch (e) { console.warn('Work rules sweep failed for', client.id, e); continue; }
            if (snap() !== before) {
                out.changed++;
                if (window.OL?.markClientDirty) window.OL.markClientDirty(client.id);
            }
        }
        if (out.changed && window.OL?.persist) await window.OL.persist();
    } finally { sweeping = false; }
    return out;
}

if (typeof setTimeout === 'function' && typeof document !== 'undefined') {
    setTimeout(() => { sweepClientWorkRules(); }, 90 * 1000);
    setInterval(() => { sweepClientWorkRules(); }, 6 * 60 * 60 * 1000);
}

window.OL = window.OL || {};
// Whether a client task belongs to a request that's active right now (Do Now, current approved round) — used
// to decide what shows nested under the consolidated follow-up task, per client task rather than per request.
export function isActiveRequestTask(client, task) {
    const links = linksForTask(task);
    if (!links.length) return false;
    return (client?.projectData?.scopingSheets || []).some((sheet) => {
        if (!sheet || sheet.kind === 'maintenance' || sheet.id === 'maintenance') return false;
        return links.some((l) => {
            const item = (sheet.lineItems || []).find((i) => i && String(i.id) === String(l.requestId));
            return item && isActiveItem(sheet, item, (i) => !isBlank(i.resourceId));
        });
    });
}

// {resourceName}: note, or {requestName}: note if the task has no resource — used by the follow-up email's
// Sphynx/Other/Review sections, since those are about the WORK (a resource or a request), not the task's own
// title.
function labelFor(client, task) {
    const links = linksForTask(task);
    for (const l of links) {
        const rid = (l.resourceIds || [])[0];
        if (rid) { const name = resourceName(client, rid); if (name) return name; }
    }
    const req = links[0] ? requestById(client, links[0].requestId) : null;
    return req ? requestTitle(client, req) : (task.title || task.name || 'Task');
}

// Everything the consolidated follow-up's compose window needs, in the four sections the email is built from:
//   1. clientAsks         — open client-facing tasks the client owes us (documents, feedback, actions), NOT
//                           reviews/confirmations — those have their own section below. {id, title, description}
//   2. pendingReview      — everything sitting with the client to review or confirm: client asks of kind "review"
//                           (or on "Pending Client Review"), plus implementation tasks on "Pending Client Review".
//                           {id, label, note} — label is what the email shows (the task's name for a client ask;
//                           the resource/request name for an implementation task); note is only sidebar context.
//   3. sphynxStalled      — implementation tasks stale 10+ days, still Sphynx's to do. {id, label, note} — note
//                           is the implementer's status-note comment (see the stale-task prompt, above).
//   4. thirdPartyStalled  — the same, for tasks on a "Pending Third Party ..." status.
// "Stalled" here always means a written status note exists — an implementer's comment on the prompt task this
// module already creates — not just "old and Pending Sphynx Action", so nothing is shown without an actual note.
// The email itself lists task NAMES only (sections 1 and 2 never include descriptions) — see sectionsText in
// features/business/client-followup.js.
export function followUpEmailData(client, ctx) {
    const all = client?.projectData?.clientTasks || [];

    const clientAskEligible = (t) => {
        const links = linksForTask(t);
        if (!links.length) return true;   // not tied to a request (e.g. added directly from this window) — always eligible
        return links.some((l) => { const item = l.requestId ? requestById(client, l.requestId) : null; return item && requestIsFollowUpEligible(client, item); });
    };
    // A client ask that is really "please review / confirm this" belongs with the pending-review work, not with the
    // documents and feedback the client owes us.
    const isReviewAsk = (t) => t.askKind === 'review' || t.status === 'Pending Client Review';
    const openClientAsks = all.filter((t) => t && !t.consolidatedFollowUp && (t.askKind || t.isClientTask)
        && t.askKind !== 'follow_up' && isOpen(t, ctx) && clientAskEligible(t));
    const taskName = (t) => t.title || t.name || 'Task';

    const clientAsks = openClientAsks.filter((t) => !isReviewAsk(t))
        .map((t) => ({ id: t.id, title: taskName(t), description: (t.description || '').replace(/^For:\s*/, '').trim() }));

    const reviewAsks = openClientAsks.filter(isReviewAsk)
        .map((t) => ({ id: t.id, label: taskName(t), note: (t.description || '').replace(/^For:\s*/, '').trim() }));
    const reviewWork = all.filter((t) => t && isImplementationTask(t, ctx) && t.status === 'Pending Client Review')
        .map((t) => ({ id: t.id, label: labelFor(client, t), note: (t.description || t.title || t.name || '').trim() }));
    const pendingReview = [...reviewAsks, ...reviewWork];

    const sphynxStalled = [];
    const thirdPartyStalled = [];
    all.filter((p) => p && p.statusNoteFor).forEach((p) => {
        const target = all.find((x) => x.id === p.statusNoteFor);
        if (!target || !isOpen(target, ctx)) return;
        const text = (p.comments || []).filter((c) => c && !isBlank(c.text)).slice(-1)[0]?.text;
        if (!text) return;   // no note written yet — nothing to report
        const row = { id: target.id, label: labelFor(client, target), note: String(text).trim() };
        (isThirdPartyWaitingStatus(target.status) ? thirdPartyStalled : sphynxStalled).push(row);
    });

    return { clientAsks, pendingReview, sphynxStalled, thirdPartyStalled };
}

export function followUpEmailDataForId(clientId) {
    const client = state.clients?.[clientId];
    if (!client) return { clientAsks: [], pendingReview: [], sphynxStalled: [], thirdPartyStalled: [] };
    return followUpEmailData(client, contextNow());
}

export function openClientTasksForId(clientId, taskId) {
    const client = state.clients?.[clientId];
    const t = client?.projectData?.clientTasks?.find((x) => x && x.id === taskId);
    if (!client || !t) return [];
    return openClientTasksFor(client, t, contextNow());
}

Object.assign(window.OL, { snoozeClientFollowUp, sweepClientWorkRules, runClientWorkRulesFor, onClientBecameOngoing, createQuarterlyCheckInFor, syncPeriodReminders, openClientTasksFor, openClientTasksForId, isActiveRequestTask, followUpEmailData, followUpEmailDataForId });
