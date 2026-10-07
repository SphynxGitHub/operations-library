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
//   6. Working rounds left in Drafting too long (setting: Automations > Templates & settings): ONE task per project to
//      follow up with the client or change the rounds' status to record the outcome. It closes itself once no round
//      is in Drafting (approved / declined / on hold).
//
// Pure functions on the client project JSON. ctx: { roles, closedNames, sphynxNames, today (YYYY-MM-DD),
// now (ISO), uid, followUpEveryDays, staleDays, isOngoing(client) }.

import { linksForTask, addLink } from './task-links.js';
import { isTaskClosed, isClientWaitingStatus, isThirdPartyWaitingStatus, isDeveloperWaitingStatus, isOffsiteWaitingStatus } from './work-status.js';
import { isClientFacing } from './request-tasks.js';
import { isRoundApproved, isActiveItem, getCurrentRound, roundStatusOf } from './requests.js';
import { isOngoing, hasTimeLogTab } from './maintenance.js';
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
// (Judged by assignee/ask kind via isClientFacing, NOT the stored isClientTask flag: that flag was set true for any
// assignee other than 'Sphynx Task', so it is stuck on tasks later given to a named Sphynx team member.)
const isImplementationTask = (t, ctx) => !!t && !t.askKind && !t.consolidatedFollowUp && !t.statusNoteFor
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

// Sphynx's own work for the purpose of waiting on the client: like an implementation task, but it does not have to be
// linked to a request (a task made by hand still loses its due date while it waits).
const isSphynxWork = (t, ctx) => !!t && !t.askKind && !t.consolidatedFollowUp && !t.statusNoteFor
    && !t.recurrenceTag && !t.testRunId && !t.reviewNotifyKey && !t.reviewFollowUpKey && !isClientFacing(t, ctx);

export function reconcileBlockedTasks(client, ctx) {
    const out = { blocked: [], released: [] };
    const all = client?.projectData?.clientTasks || [];
    all.forEach((t) => {
        if (!t || !isSphynxWork(t, ctx)) return;
        const depTasks = dependencyClientTasks(client, t, ctx);
        const clientWaiting = isClientWaitingStatus(t.status);
        // Pending Developer Update / Pending Third Party Support park the task too: the date is logged and removed the
        // same way, and comes back when the status is changed (there are no client tasks to wait for).
        const waiting = clientWaiting || isOffsiteWaitingStatus(t.status);
        const who = clientWaiting ? 'the client' : (isDeveloperWaitingStatus(t.status) ? 'a developer' : 'a third party');

        if (waiting && !t.blockedOn) {
            // Just set to a client-waiting status (by hand or via a Dependency): log the due date, remove it,
            // note what it is waiting for.
            const related = clientWaiting ? [...new Set([...relatedClientTasks(client, t, ctx).map((x) => x.id), ...depTasks.map((x) => x.id)])] : [];
            t.blockedOn = { since: ctx.now, status: t.status, dueDate: day(t.dueDate), taskIds: clientWaiting ? related : [], completed: {} };
            (t.dueDateLog = t.dueDateLog || []).push({ at: ctx.now, event: 'removed', dueDate: day(t.dueDate), status: t.status });
            if (!isBlank(t.dueDate)) addComment(t, `Due date ${day(t.dueDate)} removed while waiting on ${who} (${t.status}). ${clientWaiting ? 'It comes back when the related client tasks are complete.' : 'It comes back when the status is changed.'}`, ctx);
            t.dueDate = '';
            out.blocked.push(t.id);
        } else if (waiting && t.blockedOn) {
            // Keep the list current: client tasks added after the flip, by request/resource or by Dependency,
            // are part of what it is waiting for.
            const b = t.blockedOn;
            if (!clientWaiting) b.taskIds = [];   // now parked on a developer / third party: no client tasks to wait for
            // Moved to a different waiting status (e.g. Pending Client Review -> Pending Client Feedback) with a date
            // put back in the meantime: take it off again.
            if (b.status !== t.status) {
                b.status = t.status;
                if (!isBlank(t.dueDate)) {
                    if (isBlank(b.dueDate)) b.dueDate = day(t.dueDate);
                    (t.dueDateLog = t.dueDateLog || []).push({ at: ctx.now, event: 'removed', dueDate: day(t.dueDate), status: t.status });
                    addComment(t, `Due date ${day(t.dueDate)} removed while waiting on ${who} (${t.status}).`, ctx);
                    t.dueDate = '';
                }
            }
            if (clientWaiting) [...relatedClientTasks(client, t, ctx), ...depTasks].forEach((x) => { if (!b.taskIds.includes(x.id)) b.taskIds.push(x.id); });
            // Note when each one was completed, for the restored date.
            b.taskIds.forEach((id) => {
                const c = all.find((x) => x.id === id);
                if (c && !isOpen(c, ctx) && !b.completed[id]) b.completed[id] = day(c.completedAt || ctx.now);
            });
            const done = clientWaiting && b.taskIds.length > 0 && b.taskIds.every((id) => { const c = all.find((x) => x.id === id); return !c || !isOpen(c, ctx); });
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
        // Heal the stale flag: a Sphynx-owned task must not keep isClientTask=true (it hides it from the rules above).
        if (t.isClientTask && !t.askKind && !t.consolidatedFollowUp && !isClientFacing(t, ctx)) t.isClientTask = false;
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
    return (client?.projectData?.clientTasks || []).filter((t) => t && isOpen(t, ctx) && !isClientWaitingStatus(t.status)
        && (isImplementationTask(t, ctx) || (isOffsiteWaitingStatus(t.status) && isSphynxWork(t, ctx)))
        && t.statusChangedAt && daysBetween(day(t.statusChangedAt), ctx.today) >= days);
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
        // Parked on a developer or third party (Pending Developer Update / Pending Third Party Support): the progress
        // update is asked of the project's Communications assignee, who is the one talking to the client, not of the
        // task's own assignee (often the developer or vendor). Stale work on Sphynx's own side still prompts its assignee.
        const thirdParty = isThirdPartyWaitingStatus(t.status);
        const offsite = isOffsiteWaitingStatus(t.status);
        const promptAssignee = offsite ? communicationAssignee(client, ctx) : (t.assignee || null);
        const p = {
            id: ctx.uid(), title: `Status note: ${t.title || t.name}`, name: `Status note: ${t.title || t.name}`,
            description: `This has had no status change for ${daysBetween(day(t.statusChangedAt), ctx.today)} days${offsite ? ` — it's waiting on ${thirdParty ? 'a third party' : 'a developer'}` : ''}. Get a progress update${offsite ? ' from them' : ''}, add a comment with a short update the client can be told, then mark this Done. It will be included in the next client follow-up.`,
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

// Hours reminders: as the open block of prepaid hours (a plan period's hours, a carryover, an ad hoc purchase, a
// coaching client's prepaid hours) is used, one reminder task at 80%, 90%, 95% and 100% used. blocks: [{ id, kind
// ('plan' | 'prepaid'), hours, used, endsOn }], worked out by features/maintenance.js from the hours log.
//   - One task per block per threshold, ever (pd.hoursAlerts.seen). If time jumps past several thresholds at once
//     (say from 70% to 96%), only the highest gets a task and the ones below are skipped.
//   - The first time a client is looked at, anything already past a threshold is recorded without a task, so
//     switching this on does not bury the team in reminders for hours that were used long ago.
//   - At 100% the block is closed (see the hours page); the task says so.
export const HOURS_ALERT_LEVELS = [80, 90, 95, 100];
const hrs = (n) => String(Math.round(Number(n || 0) * 100) / 100);
export function planHoursAlerts(client, blocks, ctx) {
    const pd = client?.projectData;
    if (!pd || !Array.isArray(blocks)) return [];
    if (!Array.isArray(pd.clientTasks)) pd.clientTasks = [];
    const rec = pd.hoursAlerts = pd.hoursAlerts || { seen: {} };
    rec.seen = rec.seen || {};
    const first = !rec.baselined;
    const created = [];
    blocks.forEach((b) => {
        const total = Number(b.hours) || 0;
        if (!b.id || total <= 0) return;
        const pct = (Number(b.used) || 0) / total * 100;
        const crossed = HOURS_ALERT_LEVELS.filter((l) => pct + 1e-9 >= l && !rec.seen[`${b.id}:${l}`]);
        if (!crossed.length) return;
        if (first) { crossed.forEach((l) => { rec.seen[`${b.id}:${l}`] = 'baseline'; }); return; }
        const top = crossed[crossed.length - 1];
        crossed.slice(0, -1).forEach((l) => { rec.seen[`${b.id}:${l}`] = 'skipped'; });
        const name = client.meta?.name || 'client';
        const what = b.kind === 'plan' ? 'plan hours' : 'prepaid hours';
        const used = Number(b.used) || 0, left = Math.round((total - used) * 100) / 100;
        const title = top >= 100 ? `${what[0].toUpperCase()}${what.slice(1)} used up: ${name}` : `${top}% of ${what} used: ${name}`;
        const ask = b.kind === 'plan' ? 'Talk to the client about renewing early or adding hours.' : 'Let the client know and ask whether they want to prepay for more hours.';
        const description = top >= 100
            ? `The current block of ${hrs(total)} h is fully used (${hrs(used)} h)${left < 0 ? `, ${hrs(-left)} h over` : ''}. The block is closed. ${ask} Check before more billable work is done.`
            : `${hrs(used)} of ${hrs(total)} h used in the current block${b.endsOn ? ` (it ends ${day(b.endsOn)})` : ''}, ${hrs(left)} h left. ${ask}`;
        const t = {
            id: ctx.uid(), title, name: title, description, status: OPEN_STATUS, assignee: communicationAssignee(client, ctx),
            dueDate: ctx.today, isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'maintenance', createdAt: ctx.now,
        };
        pd.clientTasks.unshift(t); rec.seen[`${b.id}:${top}`] = t.id; created.push(t.id);
    });
    if (first) rec.baselined = ctx.today;
    return created;
}
export function syncHoursAlerts(clientId, blocks) {
    const client = state.clients?.[clientId];
    if (!client || client._metaOnly || !client.projectData) return [];
    const before = JSON.stringify(client.projectData.hoursAlerts || null);
    const created = planHoursAlerts(client, blocks, contextNow());
    if (JSON.stringify(client.projectData.hoursAlerts || null) !== before && window.OL?.markClientDirty) { window.OL.markClientDirty(clientId); window.OL.persist?.(); }
    return created;
}

// ------------------------------------------------------------------------------------------
// 5b. Zap JSON re-pull for Ongoing Maintenance clients
// ------------------------------------------------------------------------------------------
// The flow map is only as current as the last Zap export, and Zapier needs a login, so the export itself stays a
// manual step. This makes sure it is not forgotten: one task, "Re-pull Zap JSON export", appears
//   - once for a client already on Ongoing Maintenance (the first time this runs for them: a baseline), and
//   - once for a client who has just become Ongoing Maintenance (onboarding), and
//   - once each time a new plan period starts (a renewal, or the first period of a new onboard).
// A period is only ever acted on once (pd.zapRepull.seen). If a re-pull task is already open, or one was made in the
// last 30 days (a new onboard gets one task, not two when its first plan period is started), nothing more is made.
// Wording, assignee and due date are settings (Automations > Templates & settings).
export const ZAP_REPULL_TAG = 'zap-repull';
const ZAP_REPULL_QUIET_DAYS = 30;

export function planZapRepull(client, periods, ctx) {
    const pd = client?.projectData;
    const cfg = ctx.zapRepull;
    if (!pd || !cfg || cfg.enabled === false || !ctx.isOngoing || !ctx.isOngoing(client)) return [];
    if (!Array.isArray(pd.clientTasks)) pd.clientTasks = [];
    const ids = (periods || []).filter((p) => p && p.id != null).map((p) => String(p.id));
    const mine = pd.clientTasks.filter((t) => t && t.autoTag === ZAP_REPULL_TAG);
    const make = (reason, dueFrom) => {
        const vars = { client: client.meta?.name || 'client', reason };
        const title = fillTemplate(cfg.taskTitle, vars).trim() || `Re-pull Zap JSON export: ${vars.client}`;
        const due = dueFrom && dueFrom > ctx.today ? dueFrom : addDays(ctx.today, Math.max(0, Number(cfg.dueInDays) || 0));
        const t = {
            id: ctx.uid(), title, name: title, description: fillTemplate(cfg.taskDescription, vars),
            status: OPEN_STATUS, assignee: (cfg.assignee || '').trim() || communicationAssignee(client, ctx), dueDate: due,
            isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'maintenance', createdAt: ctx.now, autoTag: ZAP_REPULL_TAG,
        };
        pd.clientTasks.unshift(t);
        return t.id;
    };
    const recentOrOpen = () => mine.some((t) => isOpen(t, ctx) || daysBetween(day(t.createdAt), ctx.today) < ZAP_REPULL_QUIET_DAYS);

    // First time for this client: the baseline. Every plan period that exists now is covered by it.
    if (!pd.zapRepull) {
        pd.zapRepull = { seen: ids, at: ctx.today };
        if (mine.length) return [];
        return [make(ctx.justConverted ? 'This client has just moved to Ongoing Maintenance.' : 'Baseline re-pull for an existing Ongoing Maintenance client.')];
    }

    const seen = new Set((pd.zapRepull.seen || []).map(String));
    const fresh = (periods || []).filter((p) => p && p.id != null && !seen.has(String(p.id)));
    if (!fresh.length) return [];
    fresh.forEach((p) => seen.add(String(p.id)));
    pd.zapRepull.seen = [...seen];
    if (recentOrOpen()) return [];
    const newest = fresh.slice().sort((a, b) => day(b.start_date).localeCompare(day(a.start_date)))[0];
    return [make(`A new plan period starts ${day(newest.start_date)}.`, day(newest.start_date))];
}

// ------------------------------------------------------------------------------------------
// 6. Working rounds left in Drafting
// ------------------------------------------------------------------------------------------
// ONE follow-up task per project, covering every working round that has been in Drafting too long — not one task per
// round. A round is "in Drafting" from its statusChangedAt (stamped when the round is created or its status changes; a
// round that has none yet starts its clock the first time this runs). Once any round has been there afterDays, a task
// is made for the project's Communications person (or the assignee set in settings) listing the rounds. While it is
// open its title and description follow the list as rounds come and go. It closes ITSELF as soon as no round is left
// in Drafting (every one was approved, declined or put on hold). After a person closes it, a new one only appears
// after repeatEveryDays. Open per-round tasks from the earlier version are folded into the single one and closed.
const roundLabel = (round) => (/^\d+$/.test(String(round)) ? `Working Round ${round}` : String(round));
const DRAFTING_TASK_KEY = 'project';

function roundsLabel(rounds) {
    const labels = [...new Set(rounds.map((r) => String(r.round)))];
    const allNumeric = labels.every((l) => /^\d+$/.test(l));
    if (allNumeric) return labels.length === 1 ? `Working Round ${labels[0]}` : `Working Rounds ${labels.join(', ')}`;
    return labels.map(roundLabel).join(', ');
}

function closeDraftingTask(t, ctx, why) {
    t.status = closedList(ctx)[0]; t.completedAt = ctx.now; t.cancelledAt = ctx.now; t.autoClosed = true;
    addComment(t, why, ctx);
}

function reconcileDraftingRounds(client, ctx) {
    const cfg = ctx.drafting;
    const created = [];
    if (!cfg || cfg.enabled === false) return created;
    const afterDays = Math.max(1, Number(cfg.afterDays) || 7);
    const repeatDays = Math.max(1, Number(cfg.repeatEveryDays) || afterDays);
    const pd = client.projectData;

    // Every round currently in Drafting, with how long it has been there.
    const drafting = [];
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
            drafting.push({ key: `${sheet.id || 'sheet'}:${round}`, round, age: daysBetween(since, ctx.today) });
        });
    });

    const mine = pd.clientTasks.filter((t) => t && t.draftingFollowUpKey);
    const openMine = mine.filter((t) => isOpen(t, ctx));

    // Nothing left in Drafting: whatever follow-up is still open has done its job.
    if (!drafting.length) {
        openMine.forEach((t) => closeDraftingTask(t, ctx, 'Closed automatically: no working round is in Drafting any more (each was approved, declined or put on hold).'));
        return created;
    }

    // Per-round tasks from the earlier version are folded into the single project-level one.
    openMine.filter((t) => t.draftingFollowUpKey !== DRAFTING_TASK_KEY)
        .forEach((t) => closeDraftingTask(t, ctx, 'Closed: replaced by one follow-up task covering all working rounds in Drafting.'));

    const due = drafting.filter((d) => d.age >= afterDays).sort((x, y) => y.age - x.age);
    const vars = () => ({ round: roundsLabel(due), client: client.meta?.name || 'client', days: due[0]?.age || afterDays });
    const describe = () => {
        const base = fillTemplate(cfg.taskDescription, vars());
        if (due.length < 2) return base;
        return `${base}\n\nRounds in Drafting:\n${due.map((d) => `  - ${roundLabel(d.round)}: ${d.age} days`).join('\n')}`;
    };
    const keysNow = due.map((d) => d.key).sort().join('|');

    const main = openMine.find((t) => t.draftingFollowUpKey === DRAFTING_TASK_KEY);
    if (main) {
        // Keep the open task's list current as rounds are added to or leave the overdue set.
        if (due.length && main.draftingRoundKeys !== keysNow) {
            const title = fillTemplate(cfg.taskTitle, vars()) || `Follow up on ${vars().round}`;
            main.title = title; main.name = title; main.description = describe(); main.draftingRoundKeys = keysNow;
        }
        return created;
    }
    if (!due.length) return created;

    // A person closed the last one: wait out the repeat period before making another.
    const lastDone = mine.filter((t) => !isOpen(t, ctx) && !t.autoClosed).map((t) => day(t.completedAt || t.createdAt)).sort().pop();
    if (lastDone && daysBetween(lastDone, ctx.today) < repeatDays) return created;

    const title = fillTemplate(cfg.taskTitle, vars()) || `Follow up on ${vars().round}`;
    const t = {
        id: ctx.uid(), title, name: title, description: describe(),
        status: OPEN_STATUS, assignee: (cfg.assignee || '').trim() || communicationAssignee(client, ctx), dueDate: ctx.today,
        isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'drafting-followup', createdAt: ctx.now,
        draftingFollowUpKey: DRAFTING_TASK_KEY, draftingRoundKeys: keysNow,
    };
    pd.clientTasks.unshift(t); created.push(t.id);
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
        sphynxNames: (state.master?.sphynxTeam || []).map((m) => m.name).filter(Boolean).concat(window.OL?.thirdPartyAssignees || []),
        today: localToday(), now: new Date().toISOString(), uid,
        followUpEveryDays: Number(state.master?.followUpEveryDays) || DEFAULT_FOLLOW_UP_EVERY_DAYS,
        staleDays: Number(state.master?.staleDays) || DEFAULT_STALE_DAYS,
        thirdPartyStatusNoteAssignee: state.master?.thirdPartyStatusNoteAssignee || 'Anthony',
        drafting: getOlSettings().draftingFollowUp,
        zapRepull: getOlSettings().zapRepull,
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
    const out = reconcileMaintenance(client, ctx);
    const zap = planZapRepull(client, [], ctx);
    if (zap.length) out.created.push(...zap);
    return out;
}
export function createQuarterlyCheckInFor(client) { return createQuarterlyCheckIn(client, contextNow()); }
export function syncPeriodReminders(clientId, periods) {
    const client = state.clients?.[clientId];
    if (!client) return [];
    const ctx = contextNow();
    const before = JSON.stringify(client.projectData?.zapRepull || null);
    const created = planPeriodReminders(client, periods, ctx);
    created.push(...planZapRepull(client, periods, ctx));
    if ((created.length || JSON.stringify(client.projectData?.zapRepull || null) !== before) && window.OL?.markClientDirty) { window.OL.markClientDirty(clientId); window.OL.persist?.(); }
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
            const snap = () => JSON.stringify([client.projectData.clientTasks, client.projectData.maintenanceSetup, client.projectData.hoursAlerts, client.projectData.followUpSnoozeUntil, (client.projectData.scopingSheets || []).map((sh) => sh?.roundApprovals)]);
            const before = snap();
            try {
                // Ongoing Maintenance: read the plan periods so the two reminders before a period ends exist even
                // if nobody opens Maintenance & Hours (loadMaintenanceData makes them).
                // Also read the hours (meetings included) for maintenance and prepaid coaching clients: that is what the 80 / 90 / 95 / 100% hours reminders are worked out from.
                if (hasTimeLogTab(client) && typeof window.OL?.loadMaintenanceData === 'function') await window.OL.loadMaintenanceData(client.id);
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
//   3. sphynxStalled      — work parked on a developer (Pending Developer Update), plus stale implementation tasks that have
//                           a written status note. {id, label, note, noNote?} — note is the latest written update (a status-note
//                           comment or the note written when the task was parked); noNote marks a parked task with none yet.
//   4. thirdPartyStalled  — the same, for tasks on a "Pending Third Party ..." status.
// Everything parked on a developer / third party is listed (so the follow-up shows what is out of Sphynx's hands), but
// only the ones with a written note start checked for the email. A parked task untouched for 10+ days also gets a
// progress-update task for the project's Communications assignee (see reconcileClientFollowUp).
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
    const openClientAsks = all.filter((t) => t && !t.consolidatedFollowUp && isClientFacing(t, ctx)
        && t.askKind !== 'follow_up' && isOpen(t, ctx) && clientAskEligible(t));
    const taskName = (t) => t.title || t.name || 'Task';

    // Notes written in the "waiting on the client" window (features/business/waiting-prompt.js, task.waitingNote) on
    // work that is parked on a Pending Client status. Each shows in the sidebar under the client ask(s) the task is
    // waiting on. Sidebar context only: bulletFor() never puts a note in the email.
    const notesByAsk = new Map();
    all.filter((w) => w && !w.askKind && !w.consolidatedFollowUp && !isClientFacing(w, ctx) && isClientWaitingStatus(w.status) && !isBlank(w.waitingNote))
        .forEach((w) => {
            openClientTasksFor(client, w, ctx).forEach((a) => {
                if (!notesByAsk.has(a.id)) notesByAsk.set(a.id, []);
                notesByAsk.get(a.id).push({ label: labelFor(client, w), text: String(w.waitingNote).trim() });
            });
        });

    const clientAsks = openClientAsks.filter((t) => !isReviewAsk(t))
        .map((t) => ({ id: t.id, title: taskName(t), description: (t.description || '').replace(/^For:\s*/, '').trim(), waitNotes: notesByAsk.get(t.id) || [] }));

    const reviewAsks = openClientAsks.filter(isReviewAsk)
        .map((t) => ({ id: t.id, label: taskName(t), note: (t.description || '').replace(/^For:\s*/, '').trim(), waitNotes: notesByAsk.get(t.id) || [] }));
    // Work parked on Pending Client Review: its own written note (when there is one) is what the sidebar shows.
    const reviewWork = all.filter((t) => t && isImplementationTask(t, ctx) && t.status === 'Pending Client Review')
        .map((t) => (isBlank(t.waitingNote)
            ? { id: t.id, label: labelFor(client, t), note: (t.description || t.title || t.name || '').trim(), waitNotes: [] }
            : { id: t.id, label: labelFor(client, t), note: '', waitNotes: [{ label: '', text: String(t.waitingNote).trim() }] }));
    const pendingReview = [...reviewAsks, ...reviewWork];

    const sphynxStalled = [];
    const thirdPartyStalled = [];
    const stamp = (v) => { const t = Date.parse(v || ''); return Number.isNaN(t) ? 0 : t; };
    // The latest written status note per task: the status-note prompt's last comment, or the note written when the task
    // was parked (features/business/waiting-prompt.js) — whichever is newer.
    const noteFor = (target) => {
        let best = { text: '', at: -1 };
        all.filter((p) => p && p.statusNoteFor === target.id).forEach((p) => {
            const c = (p.comments || []).filter((x) => x && !isBlank(x.text)).slice(-1)[0];
            if (c && stamp(c.date) >= best.at) best = { text: String(c.text).trim(), at: stamp(c.date) };
        });
        if (!isBlank(target.waitingNote) && stamp(target.waitingNoteAt) >= best.at) best = { text: String(target.waitingNote).trim(), at: stamp(target.waitingNoteAt) };
        return best.text;
    };
    const listed = new Set();
    const addRow = (target, note, noNote) => {
        const row = { id: target.id, label: labelFor(client, target), note, ...(noNote ? { noNote: true } : {}) };
        (isThirdPartyWaitingStatus(target.status) ? thirdPartyStalled : sphynxStalled).push(row);
        listed.add(String(target.id));
    };

    // Everything parked on a developer or third party is on the follow-up, with its note when there is one (the
    // sidebar flags the ones with none so a progress update can be asked for).
    all.filter((w) => w && !w.askKind && !w.consolidatedFollowUp && !w.statusNoteFor && isOpen(w, ctx) && !isClientFacing(w, ctx) && isOffsiteWaitingStatus(w.status))
        .forEach((w) => { const note = noteFor(w); addRow(w, note, !note); });

    // Other stale Sphynx work with a written status note (no note yet means nothing to report).
    all.filter((p) => p && p.statusNoteFor).forEach((p) => {
        const target = all.find((x) => x.id === p.statusNoteFor);
        if (!target || !isOpen(target, ctx) || listed.has(String(target.id))) return;
        const note = noteFor(target);
        if (note) addRow(target, note, false);
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

Object.assign(window.OL, { snoozeClientFollowUp, sweepClientWorkRules, runClientWorkRulesFor, onClientBecameOngoing, createQuarterlyCheckInFor, syncPeriodReminders, syncHoursAlerts, planZapRepull, openClientTasksFor, openClientTasksForId, isActiveRequestTask, followUpEmailData, followUpEmailDataForId });
