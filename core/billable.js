//======================= CORE / BILLABLE =======================//
// Order of decisions for a TASK:
//   1. Client tasks are never billable (assignee is "Client Task" or one of
//      the client's own people). Nothing else is locked.
//   2. A manual choice (the $ toggle / bulk edit) wins.
//   3. The first matching Billable Rule that applies to tasks.
//   4. Otherwise non-billable.
// Order of decisions for a CALENDAR EVENT:
//   1. A manual $ toggle (calendar_events.billable_manual) wins.
//   2. The first matching Billable Rule that applies to events.
//   3. Otherwise non-billable.
// Events keep their result in calendar_events.billable (so every screen that
// reads it agrees); syncEventBillableFromRules() keeps it in step with the rules.
//
// Rules live in state.master.billableRules (workspace_masters.billable_rules):
//   { id, appliesTo: 'tasks' | 'events' | 'both', billable,
//     conditions: [{ field, op, value, values }] }   // ALL conditions must match
//   op: 'equals' | 'not_equals' | 'contains' | 'in' (uses `values`)
// Older rules ({ field, op, value } with no conditions) still work: they are
// read as a one-condition rule that applies to tasks.
// There are no hidden built-in defaults any more — the old ones (Ongoing
// Maintenance tasks, coaching calls) are ordinary rules you can see and edit.

import { state, db } from './data.js';
import { getRequestTypes } from './requests.js';

export const MEETING_CATEGORIES = ['Follow Up Call', 'Coaching Call', 'Introductory Call', 'General Call'];
export const PIPELINE_STATUSES = ['Discovery', 'White Glove', 'Coaching', 'Ongoing Maintenance', 'Ad Hoc Maintenance', 'Former Client', 'Former Prospect', 'Partner'];
export const TASK_TYPES = ['Sphynx Task', 'Developer / 3rd Party Task', 'Client Task'];

export const BILLABLE_RULE_OPS = { equals: 'is', not_equals: 'is not', in: 'is any of', contains: 'contains' };

const lower = (v) => String(v ?? '').trim().toLowerCase();
const uniqSorted = (arr) => [...new Set(arr.map((v) => String(v ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const clientOf = (id) => (id ? state.clients?.[id] : null);

// ---- fields ----
// appliesTo: which kind of item the field can be read from.
// options(): the choices for the value dropdown (null = free text only).
export const BILLABLE_FIELD_DEFS = {
    meetingCategory: {
        label: 'Meeting category', appliesTo: ['tasks', 'events'],
        hint: 'Events: the event\'s category. Tasks: the category of the meeting the task came from.',
        options: () => uniqSorted([...MEETING_CATEGORIES, ...knownCallTypes()])
    },
    client: {
        label: 'Project', appliesTo: ['tasks', 'events'],
        options: () => uniqSorted(Object.values(state.clients || {}).map((c) => c?.meta?.name))
    },
    projectStatus: {
        label: 'Project status', appliesTo: ['tasks', 'events'],
        options: () => [...new Set([...PIPELINE_STATUSES, ...uniqSorted(Object.values(state.clients || {}).map((c) => c?.meta?.status))])]
    },
    taskType: {
        label: 'Task type', appliesTo: ['tasks'],
        hint: 'Sphynx Task = assigned to the Sphynx team (or unassigned).',
        options: () => TASK_TYPES
    },
    assignee: {
        label: 'Assignee', appliesTo: ['tasks', 'events'],
        options: () => [...new Set(['Sphynx Task', 'Client Task',
            ...(state.master?.sphynxTeam || []).map((m) => m.name),
            ...(window.OL?.thirdPartyAssignees || [])].filter(Boolean))]
    },
    requestType: {
        label: 'Request type', appliesTo: ['tasks'],
        options: () => getRequestTypes().map((t) => ({ value: t.key, label: t.label }))
    },
    category: {
        label: 'Deliverable category', appliesTo: ['tasks'],
        options: () => uniqSorted(Object.values(state.clients || {}).flatMap((c) =>
            (c?.projectData?.clientTasks || []).map((t) => t.category || t.resourceName))).slice(0, 300)
    },
    status: {
        label: 'Task status', appliesTo: ['tasks'],
        options: () => (window.OL?.getSystemStatuses ? window.OL.getSystemStatuses() : []).map((s) => s.name)
    },
    title: { label: 'Title', appliesTo: ['tasks', 'events'], options: null }
};
// Kept for older callers: key -> label.
export const BILLABLE_RULE_FIELDS = Object.fromEntries(Object.entries(BILLABLE_FIELD_DEFS).map(([k, d]) => [k, d.label]));

// Value choices as [{ value, label }], or null for free text.
export function billableFieldOptions(field) {
    const def = BILLABLE_FIELD_DEFS[field];
    if (!def?.options) return null;
    return def.options().map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
}
export function fieldsForAppliesTo(appliesTo) {
    const kinds = appliesTo === 'both' ? ['tasks', 'events'] : [appliesTo || 'tasks'];
    return Object.keys(BILLABLE_FIELD_DEFS).filter((k) => kinds.every((kind) => BILLABLE_FIELD_DEFS[k].appliesTo.includes(kind)));
}

// Old single-condition rules read as one-condition task rules.
export function normalizeRule(r) {
    if (!r) return null;
    const conditions = Array.isArray(r.conditions) ? r.conditions
        : (r.field ? [{ field: r.field, op: r.op || 'equals', value: r.value }] : []);
    return { id: r.id, appliesTo: r.appliesTo || 'tasks', billable: r.billable !== false, conditions };
}

// ---- meeting categories of events (for tasks that came from a meeting) ----
function knownCallTypes() {
    const out = [];
    [state.master?.googleCalendarEvents, window.OL?._calendarGridEvents, window.OL?._dashboardEventsCache,
        window.OL?._eventCallTypeCache && Object.values(window.OL._eventCallTypeCache)]
        .forEach((list) => (Array.isArray(list) ? list : []).forEach((e) => e?.call_type && out.push(e.call_type)));
    return out;
}
function eventCallType(eventId) {
    if (!eventId) return '';
    const lists = [state.master?.googleCalendarEvents, window.OL?._calendarGridEvents, window.OL?._dashboardEventsCache, window.OL?._eventCallTypeCache && Object.values(window.OL._eventCallTypeCache)];
    for (const list of lists) {
        const hit = (Array.isArray(list) ? list : []).find((e) => e && String(e.id) === String(eventId));
        if (hit?.call_type) return hit.call_type;
    }
    return '';
}

// Decided from the ASSIGNEE, not the stored isClientTask flag — that flag
// was set on tasks assigned to Sphynx team members by some older quick-add
// paths, which is why team tasks were being refused as "client tasks".
export function isClientTask(task, client) {
    const a = String(task.assignee || '').trim();
    const al = a.toLowerCase();
    if (!a || al === 'sphynx task' || al === 'sphynx') return false;
    if ((state.master?.sphynxTeam || []).some((m) => String(m.name || '').trim().toLowerCase() === al)) return false;
    if ((window.OL?.thirdPartyAssignees || []).some((x) => String(x).toLowerCase() === al)) return false;
    if (al === 'client task' || al === 'client') return true;
    const c = client || state.clients?.[task.clientId];
    return (c?.projectData?.teamMembers || []).some((m) => String(m.name || '').trim().toLowerCase() === al);
}

// Same split the Tasks page shows (Sphynx / 3rd party / client), computed
// here so every screen gets the same answer.
function taskTypeOf(task) {
    const a = String(task.assignee || task.responsibleParty || '').trim();
    const al = a.toLowerCase();
    if ((window.OL?.thirdPartyAssignees || []).some((x) => String(x).toLowerCase() === al)) return 'Developer / 3rd Party Task';
    if (!a || al === 'sphynx task' || al === 'sphynx') return 'Sphynx Task';
    if ((state.master?.sphynxTeam || []).some((m) => String(m.name || '').trim().toLowerCase() === al)) return 'Sphynx Task';
    return 'Client Task';
}

function taskFieldValue(task, client, field) {
    switch (field) {
        case 'assignee': return task.assignee || '';
        case 'client': return client?.meta?.name || task.clientName || '';
        case 'projectStatus': return client?.meta?.status || '';
        case 'meetingCategory': return eventCallType(task.linkedEventId || task.parentEventId);
        case 'category': return task.category || task.resourceName || '';
        case 'title': return task.title || task.name || '';
        case 'status': return task.status || '';
        case 'taskType': return taskTypeOf(task);
        case 'requestType': {
            if (!task.requestLineItemId || !client) return '';
            const item = window.OL?.findRequestItem ? window.OL.findRequestItem(client, task.requestLineItemId) : null;
            return item?.requestType || '';
        }
        default: return '';
    }
}

function eventFieldValue(evt, field) {
    const c = clientOf(evt.linked_client_id || evt.clientId);
    switch (field) {
        case 'meetingCategory': return evt.call_type || '';
        case 'client': return c?.meta?.name || '';
        case 'projectStatus': return c?.meta?.status || '';
        case 'assignee': return evt.assignee || '';
        case 'title': return evt.title || '';
        default: return '';
    }
}

// null = condition incomplete (the whole rule is skipped until it's filled in).
function conditionMatches(cond, have) {
    const h = lower(have);
    if (cond.op === 'in') {
        const vals = (cond.values || []).map(lower).filter(Boolean);
        if (!vals.length) return null;
        return vals.includes(h);
    }
    const want = lower(cond.value);
    if (!want) return null;
    if (cond.op === 'contains') return h.includes(want);
    if (cond.op === 'not_equals') return h !== want;
    return h === want;
}

function firstMatchingRule(kind, readValue) {
    for (const raw of state.master?.billableRules || []) {
        const rule = normalizeRule(raw);
        if (!rule || !rule.conditions.length) continue;
        if (rule.appliesTo !== 'both' && rule.appliesTo !== kind) continue;
        let ok = true;
        for (const cond of rule.conditions) {
            const m = conditionMatches(cond, readValue(cond.field));
            if (m !== true) { ok = false; break; }
        }
        if (ok) return rule;
    }
    return null;
}

export function matchingBillableRule(task, client) {
    const c = client || state.clients?.[task.clientId];
    return firstMatchingRule('tasks', (f) => taskFieldValue(task, c, f));
}
export function matchingEventRule(evt) {
    return firstMatchingRule('events', (f) => eventFieldValue(evt, f));
}

export function isTaskBillable(task, client) {
    if (!task) return false;
    const c = client || state.clients?.[task.clientId];
    if (isClientTask(task, c)) return false;
    if (task.billable === true || task.billable === false) return task.billable;
    const rule = matchingBillableRule(task, c);
    return rule ? rule.billable : false;
}

// Staff resolve each task's billable status (rules need the team roster, calendar events and the rules
// themselves, which a client login doesn't load) and save it on the task as billableResolved, so a client's
// Maintenance & Hours tab counts the same hours staff see. Returns true if anything changed.
export function stampBillableFor(client) {
    if (!client?.projectData?.clientTasks || window.IS_GUEST) return false;
    let changed = false;
    client.projectData.clientTasks.forEach((t) => {
        if (!t || typeof t !== 'object') return;
        const b = isTaskBillable(t, client);
        if (t.billableResolved !== b) { t.billableResolved = b; changed = true; }
    });
    return changed;
}

// Billable for counting hours: staff work it out live; a client login reads what staff last saved.
export function isTaskBillableForHours(task, client) {
    if (!task) return false;
    if (!window.IS_GUEST) return isTaskBillable(task, client);
    if (task.billable === true || task.billable === false) return task.billable;
    return task.billableResolved === true;
}

// What an event's billable flag should be when nobody has set it by hand.
export function eventBillableFromRules(evt) {
    const rule = matchingEventRule(evt);
    return rule ? rule.billable : false;
}

// Tasks follow the rules above; calendar events use their stored flag
// (kept in step with the rules by syncEventBillableFromRules).
export function isItemBillable(item) {
    if (!item) return false;
    if (item._type === 'event' || item.isEvent) return item.billable !== false;
    return isTaskBillable(item, state.clients?.[item.clientId]);
}

export function describeRule(rule) {
    const r = normalizeRule(rule);
    if (!r) return '';
    return r.conditions.map((c) => {
        const label = BILLABLE_FIELD_DEFS[c.field]?.label || c.field;
        const val = c.op === 'in' ? (c.values || []).join(' or ') : c.value;
        return `${label} ${BILLABLE_RULE_OPS[c.op] || 'is'} "${val}"`;
    }).join(' and ');
}

export function billableReason(task, client) {
    const c = client || state.clients?.[task.clientId];
    if (isClientTask(task, c)) return 'Client task — never billable';
    if (task.billable === true || task.billable === false) return 'Set manually';
    const rule = matchingBillableRule(task, c);
    if (rule) return `Rule: ${describeRule(rule)}`;
    return 'No rule matched — non-billable';
}

// ---- keep stored event flags in step with the rules ----
// Events that nobody toggled by hand get billable = what the rules say.
// With `events`, only those are checked (a page's loaded events); without,
// every event from the last 400 days onward is. Updates the in-memory copies
// too. Returns how many changed. Quietly does nothing if billable_manual
// isn't there yet (migration not run).
export async function syncEventBillableFromRules(events) {
    try {
        let rows;
        const cols = 'id, title, linked_client_id, assignee, call_type, billable, billable_manual';
        if (Array.isArray(events)) {
            const ids = events.map((e) => e?.id).filter(Boolean);
            if (!ids.length) return 0;
            rows = [];
            for (let i = 0; i < ids.length; i += 100) {
                const { data, error } = await db.from('calendar_events').select(cols).in('id', ids.slice(i, i + 100));
                if (error) return 0;
                rows.push(...(data || []));
            }
        } else {
            const since = new Date(Date.now() - 400 * 86400000).toISOString();
            const { data, error } = await db.from('calendar_events').select(cols).eq('billable_manual', false).gte('start', since).limit(5000);
            if (error) return 0;
            rows = data || [];
        }

        const toTrue = [], toFalse = [];
        rows.forEach((r) => {
            if (r.billable_manual) return;
            const want = eventBillableFromRules(r);
            if (want !== (r.billable === true)) (want ? toTrue : toFalse).push(r.id);
        });
        for (const [ids, value] of [[toTrue, true], [toFalse, false]]) {
            for (let i = 0; i < ids.length; i += 100) {
                const { error } = await db.from('calendar_events').update({ billable: value }).in('id', ids.slice(i, i + 100)).eq('billable_manual', false);
                if (error) { console.warn('Could not update event billable flags:', error.message); return 0; }
            }
        }
        const changed = new Map([...toTrue.map((id) => [id, true]), ...toFalse.map((id) => [id, false])]);
        if (changed.size) {
            [state.master?.googleCalendarEvents, window.OL?._calendarGridEvents, window.OL?._dashboardEventsCache].forEach((list) =>
                (list || []).forEach((e) => { if (changed.has(e.id)) e.billable = changed.get(e.id); }));
        }
        return changed.size;
    } catch (_e) { return 0; }
}

// After the rules are edited, re-check every event (debounced so typing
// in a value doesn't fire a sweep per keystroke).
let sweepTimer = null;
export function scheduleEventBillableSweep() {
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(async () => {
        const n = await syncEventBillableFromRules();
        if (n && typeof window.OL?.refreshTaskView === 'function') window.OL.refreshTaskView();
    }, 1500);
}

// Meeting category of every recent event, so tasks that came from a meeting
// can be matched by "Meeting category". Loaded quietly in the background.
export async function loadEventCallTypes() {
    try {
        const since = new Date(Date.now() - 400 * 86400000).toISOString();
        const { data, error } = await db.from('calendar_events').select('id, call_type').not('call_type', 'is', null).gte('start', since).limit(10000);
        if (error) return;
        const map = {};
        (data || []).forEach((e) => { map[e.id] = e; });
        window.OL._eventCallTypeCache = map;
    } catch (_e) { /* optional */ }
}
export const loadCoachingEventTypes = loadEventCallTypes; // old name
if (typeof window !== 'undefined') {
    setTimeout(loadEventCallTypes, 8000);
    setInterval(loadEventCallTypes, 10 * 60 * 1000);
}

window.OL = window.OL || {};
Object.assign(window.OL, {
    loadCoachingEventTypes, loadEventCallTypes, isTaskBillable, isItemBillable, stampBillableFor, isTaskBillableForHours, billableReason, matchingBillableRule,
    matchingEventRule, eventBillableFromRules, syncEventBillableFromRules, scheduleEventBillableSweep,
    isClientTaskForBilling: isClientTask, describeBillableRule: describeRule, normalizeBillableRule: normalizeRule,
    billableFieldOptions, billableFieldsForAppliesTo: fieldsForAppliesTo,
    BILLABLE_RULE_FIELDS, BILLABLE_FIELD_DEFS, BILLABLE_RULE_OPS, MEETING_CATEGORIES
});
