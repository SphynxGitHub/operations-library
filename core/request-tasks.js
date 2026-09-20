//======================= CORE / REQUEST TASKS =======================//
// The tasks that belong to a request, grouped for the scoping sheet, the request window and the printed sheet:
//   Before          pre-meeting or pre-implementation dependencies (things to have in place first), including asks to the client
//   Implementation  the work itself: SOP steps, fixes from testing and from the client's review
//   After           post-meeting action items
// plus the ones that are the client's to do ("client-facing").
// A request's start and end dates are the earliest and latest due date among its tasks (worked out, never stored).
// Pure functions on the client project JSON.

import { isTaskClosed } from './work-status.js';

export const PHASES = ['before', 'implementation', 'after'];
export const PHASE_LABELS = { before: 'Before', implementation: 'Implementation', after: 'After' };

const CLIENT_ASK_KINDS = ['review', 'document', 'feedback'];
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const sameId = (a, b) => !isBlank(a) && !isBlank(b) && String(a) === String(b);
const dayOf = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');

// Tasks that belong to the request: linked by requestLineItemId, plus the action items of its meeting when a
// meeting has been linked to it (the meeting summary makes those with the event's id).
export function tasksForRequest(client, item) {
    const tasks = client?.projectData?.clientTasks || [];
    if (!item) return [];
    return tasks.filter((t) => t && (sameId(t.requestLineItemId, item.id)
        || (!isBlank(item.linkedEventId) && (sameId(t.parentEventId, item.linkedEventId) || sameId(t.linkedEventId, item.linkedEventId)))));
}

// Which group a task is in. A phase set on the task (or on its SOP step) wins; otherwise: asks come first,
// a linked meeting's action items come after, and everything else is implementation.
export function taskPhase(task, item) {
    if (task && PHASES.includes(task.phase)) return task.phase;
    if (!task) return 'implementation';
    if (task.askKind) return 'before';
    const fromMeeting = item && !isBlank(item.linkedEventId) && !sameId(task.requestLineItemId, item.id)
        && (sameId(task.parentEventId, item.linkedEventId) || sameId(task.linkedEventId, item.linkedEventId));
    return fromMeeting ? 'after' : 'implementation';
}

// Is this task the client's to do? An ask to the client, or a task assigned to the client (or one of their team).
// ctx: { sphynxNames: Set|Array of names that are Sphynx or third parties }
export function isClientFacing(task, ctx = {}) {
    if (!task) return false;
    if (CLIENT_ASK_KINDS.includes(task.askKind)) return true;
    if (task.askKind) return false;                       // third-party asks and Sphynx's own follow-ups
    const assignee = String(task.assignee || '').trim();
    if (!assignee) return false;
    const sphynx = new Set([...(ctx.sphynxNames || []), 'Sphynx Task', 'Sphynx']);
    if (sphynx.has(assignee)) return false;
    return true;                                          // 'Client Task', or a named person on the client's team
}

const byDueThenTitle = (a, b) => {
    const da = dayOf(a.task.dueDate) || '9999-99-99', db = dayOf(b.task.dueDate) || '9999-99-99';
    return da === db ? String(a.task.title || a.task.name || '').localeCompare(String(b.task.title || b.task.name || '')) : da.localeCompare(db);
};

// The earliest and latest due date among tasks ({ task } entries or plain tasks). Blank when none has a date.
export function taskDateRange(entries) {
    const days = (entries || []).map((e) => dayOf((e && e.task ? e.task : e)?.dueDate)).filter(Boolean).sort();
    return { start: days[0] || '', end: days[days.length - 1] || '' };
}

// ctx: { closedNames, sphynxNames }
export function groupRequestTasks(client, item, ctx = {}) {
    const closed = ctx.closedNames && ctx.closedNames.length ? ctx.closedNames : ['Done'];
    const groups = { before: [], implementation: [], after: [] };
    const entries = tasksForRequest(client, item).map((task) => ({
        task, phase: taskPhase(task, item), done: isTaskClosed(task, closed), clientFacing: isClientFacing(task, ctx),
    }));
    entries.forEach((e) => groups[e.phase].push(e));
    PHASES.forEach((p) => groups[p].sort(byDueThenTitle));
    const all = entries.slice().sort(byDueThenTitle);
    return {
        groups, entries: all, total: entries.length, done: entries.filter((e) => e.done).length,
        dates: taskDateRange(entries), clientOpen: all.filter((e) => e.clientFacing && !e.done),
    };
}

// The dates for a resource: across the tasks of every request on it, and the tasks attached to it directly.
export function resourceDates(client, resourceId, ctx = {}) {
    if (isBlank(resourceId)) return { start: '', end: '' };
    const pd = client?.projectData || {};
    const tasks = new Map();
    (pd.scopingSheets || []).forEach((sheet) => (sheet?.lineItems || []).forEach((item) => {
        if (item && sameId(item.resourceId, resourceId)) tasksForRequest(client, item).forEach((t) => tasks.set(t.id, t));
    }));
    (pd.clientTasks || []).forEach((t) => { if (t && sameId(t.parentResourceId, resourceId)) tasks.set(t.id, t); });
    return taskDateRange([...tasks.values()]);
}

// What the client has to do, request by request, for the printed sheet: open client-facing tasks on Do Now requests.
export function clientTasksByRequest(client, ctx = {}) {
    const out = [];
    (client?.projectData?.scopingSheets || []).forEach((sheet) => (sheet?.kind === 'maintenance' ? [] : (sheet?.lineItems || [])).forEach((item) => {
        if (!item || isBlank(item.id) || String(item.status || '') !== 'Do Now') return;
        const title = !isBlank(item.name) ? String(item.name).trim() : (ctx.resourceNameFor ? ctx.resourceNameFor(item) : '') || 'Request';
        const g = groupRequestTasks(client, item, ctx);
        const mine = g.entries.filter((e) => e.clientFacing && !e.done);
        if (!mine.length) return;
        const r = parseInt(item.round, 10);
        out.push({
            itemId: String(item.id), title, round: Number.isFinite(r) && r >= 1 ? r : 1,
            tasks: mine.map((e) => ({
                title: String(e.task.title || e.task.name || 'Task'), dueDate: dayOf(e.task.dueDate),
                kind: ({ review: 'Review', document: 'Document', feedback: 'Feedback' })[e.task.askKind] || '',
                phase: e.phase,
            })),
        });
    }));
    return out.sort((a, b) => a.round - b.round || a.title.localeCompare(b.title));
}

// The last page of the printed sheet. Empty text when the client has nothing to do.
export function renderClientTasksAppendix(list, { esc, clientName } = {}) {
    const e = esc || ((s) => String(s ?? ''));
    if (!list || !list.length) return '';
    const fmt = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Date to be confirmed');
    const rounds = [...new Set(list.map((r) => r.round))];
    const blocks = rounds.map((round) => `
      <div class="ct-round">
        <div class="ct-round-title">Round ${round}</div>
        ${list.filter((r) => r.round === round).map((r) => `
          <div class="ct-request">
            <div class="ct-request-name">${e(r.title)}</div>
            ${r.tasks.map((t) => `
              <div class="ct-task"><span class="ct-box"></span>
                <span class="ct-task-title">${e(t.title)}${t.kind ? ` <span class="ct-kind">${e(t.kind)}</span>` : ''}</span>
                <span class="ct-due">${e(fmt(t.dueDate))}</span></div>`).join('')}
          </div>`).join('')}
      </div>`).join('');
    return `
<div class="ct-page">
  <div class="ct-title">What we need from you</div>
  <div class="ct-sub">${e(clientName || '')}</div>
  <p class="ct-intro">To keep the work on schedule, these are the items we need from you for the requests on this sheet. Each has the date we would like to have it by.</p>
  ${blocks}
</div>`;
}

export const CLIENT_TASKS_CSS = `
.ct-page { page-break-before: always; padding-top: 4px; }
.ct-title { font-size: 20px; font-weight: 800; color: #0f172a; }
.ct-sub { font-size: 11px; color: #64748b; margin: 3px 0 10px; }
.ct-intro { font-size: 10px; color: #475569; margin-bottom: 16px; max-width: 640px; line-height: 1.5; }
.ct-round { margin-bottom: 16px; break-inside: avoid; }
.ct-round-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; color: #0ea5e9; padding: 5px 10px; background: #f8fafc; border-left: 3px solid #0ea5e9; margin-bottom: 6px; }
.ct-request { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; break-inside: avoid; }
.ct-request-name { font-size: 11px; font-weight: 700; margin-bottom: 4px; }
.ct-task { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 10px; }
.ct-box { width: 10px; height: 10px; border: 1px solid #64748b; border-radius: 2px; flex-shrink: 0; }
.ct-task-title { flex: 1; }
.ct-kind { font-size: 8px; font-weight: 700; text-transform: uppercase; border: 1px solid #e2e8f0; border-radius: 3px; padding: 0 5px; color: #475569; margin-left: 4px; }
.ct-due { color: #475569; font-variant-numeric: tabular-nums; white-space: nowrap; }`;
