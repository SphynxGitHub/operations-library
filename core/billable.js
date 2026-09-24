//======================= CORE / BILLABLE =======================//
// Order of decisions for a task:
//   1. Client tasks are never billable (assignee is "Client Task" or one of
//      the client's own people). Nothing else is locked.
//   2. A manual choice (the $ toggle / bulk edit) wins.
//   3. The first matching Billable Rule (Automations > Billable Rules).
//   4. Built-in defaults: tasks on Ongoing Maintenance projects, and tasks
//      from coaching calls, are billable.
//   5. Otherwise non-billable.
// Calendar events: Coaching Calls are billable by default; any event can be
// toggled by hand.
//
// Rules live in state.master.billableRules (workspace_masters.billable_rules):
//   { id, field, op, value, billable }
//   field: 'assignee' | 'client' | 'requestType' | 'taskType' | 'category' | 'title' | 'status'
//   op:    'equals' | 'contains'
// First matching rule wins; `billable` is what it sets (a rule can also force
// false, e.g. "title contains internal").

import { state, db } from './data.js';

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

// Decided from the ASSIGNEE, not the stored isClientTask flag — that flag
// was set on tasks assigned to Sphynx team members by some older quick-add
// paths, which is why team tasks were being refused as "client tasks".
function isClientTask(task, client) {
    const a = String(task.assignee || '').trim();
    const al = a.toLowerCase();
    if (!a || al === 'sphynx task' || al === 'sphynx') return false;
    if ((state.master?.sphynxTeam || []).some((m) => String(m.name || '').trim().toLowerCase() === al)) return false;
    if ((window.OL?.thirdPartyAssignees || []).some((x) => String(x).toLowerCase() === al)) return false;
    if (al === 'client task' || al === 'client') return true;
    const c = client || state.clients?.[task.clientId];
    return (c?.projectData?.teamMembers || []).some((m) => String(m.name || '').trim().toLowerCase() === al);
}

// ---- built-in defaults ----
function eventCallType(eventId) {
    if (!eventId) return '';
    const lists = [state.master?.googleCalendarEvents, window.OL?._calendarGridEvents, window.OL?._dashboardEventsCache, window.OL?._eventCallTypeCache && Object.values(window.OL._eventCallTypeCache)];
    for (const list of lists) {
        const hit = (Array.isArray(list) ? list : []).find((e) => e && String(e.id) === String(eventId));
        if (hit?.call_type) return hit.call_type;
    }
    return '';
}
export function builtInBillableDefault(task, client) {
    const c = client || state.clients?.[task.clientId];
    if (c?.meta?.status === 'Ongoing Maintenance') return 'Ongoing Maintenance project';
    const ct = eventCallType(task.linkedEventId || task.parentEventId);
    if (/coaching/i.test(ct)) return 'From a coaching call';
    if (/\bcoaching\b/i.test(task.title || task.name || '') && /\b(call|session|meeting)\b/i.test(task.title || task.name || '')) return 'Coaching call';
    return '';
}
export function isEventBillableDefault(evt) { return /coaching/i.test(evt?.call_type || ''); }

function fieldValue(task, client, field) {
    switch (field) {
        case 'assignee': return task.assignee || '';
        case 'client': return client?.meta?.name || task.clientName || '';
        case 'category': return task.category || task.resourceName || '';
        case 'title': return task.title || task.name || '';
        case 'status': return task.status || '';
        case 'taskType': return task.taskType || (isClientTask(task, client) ? 'Client Task' : 'Sphynx Task');
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
    const c = client || state.clients?.[task.clientId];
    if (isClientTask(task, c)) return false;
    if (task.billable === true || task.billable === false) return task.billable;
    const rule = matchingBillableRule(task, c);
    if (rule) return rule.billable !== false;
    return !!builtInBillableDefault(task, c);
}

// Tasks follow the rules above; calendar events keep their own flag.
export function isItemBillable(item) {
    if (!item) return false;
    if (item._type === 'event' || item.isEvent) return item.billable !== false;
    return isTaskBillable(item, state.clients?.[item.clientId]);
}

export function billableReason(task, client) {
    const c = client || state.clients?.[task.clientId];
    if (isClientTask(task, c)) return 'Client task — never billable';
    if (task.billable === true || task.billable === false) return 'Set manually';
    const rule = matchingBillableRule(task, c);
    if (rule) return `Rule: ${BILLABLE_RULE_FIELDS[rule.field] || rule.field} ${rule.op === 'contains' ? 'contains' : 'is'} "${rule.value}"`;
    const d = builtInBillableDefault(task, c);
    if (d) return `Default — ${d}`;
    return 'Default — non-billable';
}

// Which calendar events are coaching calls (for the "tasks from a coaching
// call are billable" default). Loaded quietly in the background.
export async function loadCoachingEventTypes() {
    try {
        const since = new Date(Date.now() - 400 * 86400000).toISOString();
        const { data, error } = await db.from('calendar_events').select('id, call_type').ilike('call_type', '%coaching%').gte('start', since).limit(5000);
        if (error) return;
        const map = {};
        (data || []).forEach((e) => { map[e.id] = e; });
        window.OL._eventCallTypeCache = map;
    } catch (_e) { /* optional */ }
}
if (typeof window !== 'undefined') {
    setTimeout(loadCoachingEventTypes, 8000);
    setInterval(loadCoachingEventTypes, 10 * 60 * 1000);
}

window.OL = window.OL || {};
Object.assign(window.OL, { loadCoachingEventTypes, isTaskBillable, isItemBillable, billableReason, matchingBillableRule, isClientTaskForBilling: isClientTask, builtInBillableDefault, isEventBillableDefault, BILLABLE_RULE_FIELDS });
