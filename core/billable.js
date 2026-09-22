//======================= CORE / BILLABLE =======================//
// Every task is NON-billable by default. A task becomes billable only when:
//   1. someone set it explicitly (the $ toggle or bulk edit wrote true/false), or
//   2. a Billable Rule matches it (Time Reports > Billable Rules).
// Client tasks are never billable, whatever the toggle or rules say.
//
// Rules live in state.master.billableRules (workspace_masters.billable_rules):
//   { id, field, op, value, billable }
//   field: 'assignee' | 'client' | 'requestType' | 'taskType' | 'category' | 'title' | 'status'
//   op:    'equals' | 'contains'
// First matching rule wins; `billable` is what it sets (a rule can also force
// false, e.g. "title contains internal").

import { state } from './data.js';

export const BILLABLE_RULE_FIELDS = {
    assignee: 'Assignee',
    client: 'Project',
    requestType: 'Request type',
    taskType: 'Task type',
    category: 'Deliverable category',
    title: 'Task title',
    status: 'Status'
};

const lower = (v) => String(v ?? '').trim().toLowerCase();

function isClientTask(task) {
    if (task.isClientTask) return true;
    const a = task.assignee;
    if (!a || a === 'Sphynx Task' || a === 'Sphynx') return false;
    if ((window.OL?.thirdPartyAssignees || []).includes(a)) return false;
    if ((state.master?.sphynxTeam || []).some((m) => m.name === a)) return false;
    return true; // a named person who isn't Sphynx or a vendor is on the client's side
}

function fieldValue(task, client, field) {
    switch (field) {
        case 'assignee': return task.assignee || '';
        case 'client': return client?.meta?.name || task.clientName || '';
        case 'category': return task.category || task.resourceName || '';
        case 'title': return task.title || task.name || '';
        case 'status': return task.status || '';
        case 'taskType': return task.taskType || (isClientTask(task) ? 'Client Task' : 'Sphynx Task');
        case 'requestType': {
            if (!task.requestLineItemId || !client) return '';
            const item = window.OL?.findRequestItem ? window.OL.findRequestItem(client, task.requestLineItemId) : null;
            return item?.requestType || '';
        }
        default: return '';
    }
}

export function matchingBillableRule(task, client) {
    for (const rule of state.master?.billableRules || []) {
        if (!rule || !rule.field || rule.value === undefined) continue;
        const have = lower(fieldValue(task, client, rule.field));
        const want = lower(rule.value);
        if (!want) continue;
        if (rule.op === 'contains' ? have.includes(want) : have === want) return rule;
    }
    return null;
}

export function isTaskBillable(task, client) {
    if (!task) return false;
    if (isClientTask(task)) return false;
    if (task.billable === true || task.billable === false) return task.billable;
    const rule = matchingBillableRule(task, client || state.clients?.[task.clientId]);
    return rule ? rule.billable !== false : false;
}

// Tasks follow the rules above; calendar events keep their own flag.
export function isItemBillable(item) {
    if (!item) return false;
    if (item._type === 'event' || item.isEvent) return item.billable !== false;
    return isTaskBillable(item, state.clients?.[item.clientId]);
}

export function billableReason(task, client) {
    if (isClientTask(task)) return 'Client task — never billable';
    if (task.billable === true || task.billable === false) return 'Set manually';
    const rule = matchingBillableRule(task, client || state.clients?.[task.clientId]);
    if (rule) return `Rule: ${BILLABLE_RULE_FIELDS[rule.field] || rule.field} ${rule.op === 'contains' ? 'contains' : 'is'} "${rule.value}"`;
    return 'Default — non-billable';
}

window.OL = window.OL || {};
Object.assign(window.OL, { isTaskBillable, isItemBillable, billableReason, matchingBillableRule, isClientTaskForBilling: isClientTask, BILLABLE_RULE_FIELDS });
