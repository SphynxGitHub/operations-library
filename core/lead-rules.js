//======================= CORE / LEAD RULES =======================//
// A new lead gets no new status. While someone is still deciding what to quote, the project stays in Discovery (the
// general holding stage) and a task is the record of what is owed:
//
//   Prepare quote        the lead wants a quote for clear scope
//   Offer paid scoping   the lead wants us to review their workflows and recommend (always paid scoping)
//
// Once the quote task is closed the scoping sheet's own status (Drafting, Approved, Declined) takes over:
//   - follow-ups for a round in Drafting do not start while a quote task is still open, and count from the day it closed
//   - when every round is Declined on a project that is still pre-client, it moves to Former Prospect by itself
//
// Pure functions on one client's project JSON. ctx: { roles, closedNames, today, now, uid }

import { assigneeForRole } from './testing.js';
import { isTaskClosed } from './work-status.js';
import { recordStatusChange } from './status-kpis.js';

export const LEAD_TASK_KINDS = {
    prepare_quote: { title: 'Prepare quote: {client}', description: 'The lead wants a quote. Prepare the scoping sheet and send it. Follow-ups on the sheet start once this task is closed.' },
    offer_paid_scoping: { title: 'Offer paid scoping: {client}', description: 'The lead wants workflow review and recommendations. Offer a paid scoping engagement.' },
};

// Intent read from a lead's message, in the order they are offered to the person confirming it.
export const LEAD_INTENTS = [
    { key: 'quote', label: 'Clear scope, quote wanted', task: 'prepare_quote' },
    { key: 'paid_scoping', label: 'Review and recommendations', task: 'offer_paid_scoping' },
    { key: 'intro_call', label: 'Wants to talk first', task: null },
    { key: 'unclear', label: 'Unclear', task: null },
];

// What happens after an intro call (the "Review Intro Call Questionnaire and Notes" task records one of these).
export const SCOPING_OUTCOMES = [
    { key: 'quote', label: 'Prepare a quote', task: 'prepare_quote' },
    { key: 'paid_scoping', label: 'Offer paid scoping', task: 'offer_paid_scoping' },
    { key: 'not_a_fit', label: 'Not a fit', task: null },
    { key: 'waiting', label: 'Waiting on the lead', task: null },
];

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const dayOf = (iso) => (isBlank(iso) ? '' : String(iso).slice(0, 10));
const closedList = (ctx) => (ctx.closedNames && ctx.closedNames.length ? ctx.closedNames : ['Done']);

// Is a quote task still open, and when was the last one closed?
export function quoteTaskState(client, ctx) {
    const tasks = (client?.projectData?.clientTasks || []).filter((t) => t && t.leadTaskKind === 'prepare_quote');
    const names = closedList(ctx);
    const open = tasks.some((t) => !isTaskClosed(t, names));
    const closedDay = tasks.filter((t) => isTaskClosed(t, names) && !t.cancelledAt).map((t) => dayOf(t.completedAt)).filter(Boolean).sort().pop() || '';
    return { open, closedDay, any: tasks.length > 0 };
}

// The person who owns the sale: the Sales role, else the Scoping role, else the shared pool.
export function leadOwnerFor(client, ctx) {
    const sales = assigneeForRole(client, ctx.roles || [], /sales/i, '');
    return sales || assigneeForRole(client, ctx.roles || [], /scop/i, 'Sphynx Task');
}

// Creates a lead task unless an open one of that kind is already there. Returns the task, or null.
export function createLeadTask(client, kind, ctx, { dueInDays = 2, note } = {}) {
    const spec = LEAD_TASK_KINDS[kind];
    if (!spec || !client?.projectData) return null;
    if (!Array.isArray(client.projectData.clientTasks)) client.projectData.clientTasks = [];
    const names = closedList(ctx);
    if (client.projectData.clientTasks.some((t) => t && t.leadTaskKind === kind && !isTaskClosed(t, names))) return null;
    const title = spec.title.replace('{client}', client.meta?.name || 'lead');
    const due = new Date(`${ctx.today}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + dueInDays);
    const task = {
        id: ctx.uid(), title, name: title, description: note ? `${spec.description}\n\n${note}` : spec.description,
        status: 'Pending Sphynx Action', assignee: leadOwnerFor(client, ctx), dueDate: due.toISOString().slice(0, 10),
        isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'lead-rules', createdAt: ctx.now, leadTaskKind: kind,
    };
    client.projectData.clientTasks.unshift(task);
    return task;
}

// Pre-client = still in the general holding stage.
export const isPreClient = (client) => String(client?.meta?.status || '') === 'Discovery';

// Every working round has been Declined and the project is still pre-client -> Former Prospect.
// A project with no rounds, or any round that is not Declined (Drafting, Approved, On Hold, Complete), stays where it is.
export function reconcileLostLead(client, ctx, roundStatusOf) {
    if (!isPreClient(client)) return [];
    const statuses = [];
    (client.projectData?.scopingSheets || []).forEach((sheet) => {
        if (!sheet || sheet.kind === 'maintenance' || sheet.id === 'maintenance') return;
        const rounds = new Set((sheet.lineItems || []).filter((i) => i && !isBlank(i.round)).map((i) => String(i.round)));
        rounds.forEach((r) => statuses.push(roundStatusOf(sheet, r)));
    });
    if (!statuses.length || !statuses.every((s) => s === 'Declined')) return [];
    const from = client.meta.status;
    client.meta.status = 'Former Prospect';
    recordStatusChange(client.meta, from, 'Former Prospect', ctx.now);
    return ['Former Prospect'];
}
