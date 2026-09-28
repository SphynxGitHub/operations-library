//======================= CORE / ACTIVATION =======================//
// Turns a newly-activated Do Now item (round approved, no activatedAt yet —
// see core/requests.js listNewActivations) into a reviewable plan of tasks:
// one default implementation/revision task per resource on the request (or
// one for the request itself, when it has no resources — an audit or a
// time-based-billing request isn't a resource build), plus any before-phase
// client-ask tasks its SOP calls for. The plan is what the activation-review
// screen renders for a human to edit before anything is actually created;
// committing it creates real tasks linked via core/task-links.js's addLink.
//
// Ask templates live in the master registry as askTemplates, same pattern as
// testTemplates (core/testing.js) — DEFAULT_ASK_TEMPLATES below is the
// starting set, used until the org saves its own. ASSIGNEE_BY_TYPE is a flat
// request-type lookup, checked before falling back to role-based assignment
// (assigneeForRole, reused from core/testing.js).
//
// SOP refinement: every commit compares what got included against the SOP's
// current defaults. A default task unchecked, or a task added that wasn't
// on the SOP at all, gets logged (see recordAskTemplateOverrides) — exact
// membership against the CURRENT template list, no fuzzy matching. As the
// SOP gets folded back into shape over time, activations naturally match
// the defaults more often and the override log — and the prompts to fold
// things back in — taper off on their own.

import { addLink } from './task-links.js';
import { assigneeForRole } from './testing.js';
import { findFirstAvailableDate, DEFAULT_TASK_ESTIMATE_HOURS } from './scheduling.js';

const lc = (v) => String(v ?? '').toLowerCase();
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const fill = (text, vars) => String(text ?? '').replace(/\{(resource|request)\}/g, (_, k) => vars[k] || '');

// A starting set, used until an org saves its own under Ask templates (same
// idea as DEFAULT_TEST_TEMPLATES in core/testing.js). One task per template,
// not a checklist — {resource}/{request} fill in from the actual names.
export const DEFAULT_ASK_TEMPLATES = [
    { id: 'at-login', name: 'App login', requestTypes: ['build'], resourceTypes: ['zap', 'zapier', 'automation', 'crm', 'integration'], fallback: false,
      askKind: 'document', title: 'App login — {resource}', instructions: 'Get login credentials or API access for {resource}.' },
    { id: 'at-brand', name: 'Brand assets', requestTypes: ['build'], resourceTypes: ['form', 'email', 'campaign', 'event'], fallback: false,
      askKind: 'document', title: 'Brand assets for {resource}', instructions: 'Logo, colors and any existing templates for {resource}.' },
    { id: 'at-fieldlist', name: 'Field list', requestTypes: ['build'], resourceTypes: ['form', 'crm', 'intake'], fallback: false,
      askKind: 'document', title: 'Field list for {resource}', instructions: 'Which fields/data points {resource} needs to capture.' },
    { id: 'at-feedback', name: 'Kickoff feedback', requestTypes: ['revision'], resourceTypes: [], fallback: false,
      askKind: 'feedback', title: 'Confirm exactly what should change on {resource}', instructions: 'Get specifics before starting the revision.' },
];

// ---- which templates apply (same shape as testing.js's templateApplies/pickTemplates) ----
export function askTemplateApplies(t, requestType, resourceType) {
    if (!t) return false;
    // "Stop asking for this on future requests like this one" (Smart SOP Updates) — a per-template
    // exclusion for one request type (and resource type, when given) rather than deleting the template.
    if ((t.excludeFor || []).some((x) => lc(x.requestType) === lc(requestType) && (isBlank(x.resourceType) || lc(x.resourceType) === lc(resourceType)))) return false;
    const types = (t.requestTypes || []).map(lc);
    if (types.length && !types.includes(lc(requestType))) return false;
    const resTypes = (t.resourceTypes || []).map(lc);
    if (resTypes.length === 0) return true;
    const rt = lc(resourceType);
    return !!rt && resTypes.some((x) => rt.includes(x) || x.includes(rt));
}

export function pickAskTemplates(templates, requestType, resourceType) {
    const list = (templates || []).filter((t) => t && !isBlank(t.title));
    const applies = list.filter((t) => !t.fallback && askTemplateApplies(t, requestType, resourceType));
    const specific = applies.filter((t) => (t.resourceTypes || []).length > 0);
    const typeOnly = applies.filter((t) => (t.resourceTypes || []).length === 0);
    const picked = [...specific, ...typeOnly];
    if (specific.length === 0) picked.push(...list.filter((t) => t.fallback && askTemplateApplies(t, requestType, resourceType)));
    return picked;
}

// ---- assignee suggestion: type first, role second ----
// assigneeByType: { [requestType]: name } — a flat lookup (forms -> Anthony,
// zaps -> Arielle), checked before falling back to role-based assignment.
export function suggestAssignee(client, roles, requestType, assigneeByType, fallbackPattern = /implement/i) {
    const byType = (assigneeByType || {})[lc(requestType)];
    if (byType) return byType;
    return assigneeForRole(client, roles, fallbackPattern);
}

// ---- the plan itself ----
// One row per proposed task: { id, kind: 'implementation'|'ask', templateId, title, instructions, askKind,
//   resourceId, resourceName, assignee, included }. "included" is what the review screen's checkboxes bind
// to — everything starts true (the SOP loads as-is), a human toggles what they don't want, or adds a row
// with templateId: null for something the SOP didn't call for.
export function buildActivationPlan({ item, resources, requestType, resourceType, askTemplates, client, roles, assigneeByType, uid, calendarEvents = [], existingTasks = [] }) {
    const title = item?.name || resources?.[0]?.name || 'Request';
    const plan = [];

    // One implementation/revision task per resource on the request, or one
    // for the request itself when it has no resources (an audit or a
    // time-based-billing request — not every request is a resource build).
    const targets = resources && resources.length ? resources : [{ id: null, name: title, type: resourceType }];
    targets.forEach((res) => {
        // The request's own Implementation person (set in the request window) wins; then request
        // type, then the project's default.
        const implRole = (roles || []).find((r) => /implement/i.test(String(r?.name || '')));
        const requestImpl = implRole && item?.roleAssignments ? String(item.roleAssignments[implRole.id] || '').trim() : '';
        const assignee = requestImpl || suggestAssignee(client, roles, requestType, assigneeByType);
        const estimatedHours = DEFAULT_TASK_ESTIMATE_HOURS;
        // Auto-slotted against the same growing task list each row adds to
        // (see below), so two implementation rows in one plan for the same
        // assignee don't both get suggested the same already-full day.
        const slot = findFirstAvailableDate({ calendarEvents, tasks: existingTasks, assignee, estimatedHours });
        plan.push({
            id: uid(), kind: 'implementation', templateId: null,
            title: res.id ? `Build/revise ${res.name}` : `Work on ${title}`,
            instructions: '', askKind: null,
            resourceId: res.id, resourceName: res.name,
            assignee, estimatedHours,
            dueDate: slot.date, dueDateReason: slot.date ? null : slot.reason,
            included: true,
        });
        // So the NEXT implementation row's own auto-slot search sees this
        // one's hours already queued, rather than every row in the same
        // plan racing for the same first-available day.
        if (slot.date) {
            existingTasks = [...existingTasks, { assignee, dueDate: slot.date, estimatedHours, status: 'Open' }];
        }
    });

    // Before-phase client-ask tasks from the SOP, one pass per resource
    // (so a two-resource request gets each resource's own relevant asks),
    // scoped to whichever resource they matched.
    const vars = { resource: resources?.[0]?.name || title, request: title };
    targets.forEach((res) => {
        pickAskTemplates(askTemplates, requestType, res.type || resourceType).forEach((t) => {
            plan.push({
                id: uid(), kind: 'ask', templateId: t.id,
                title: fill(t.title, { ...vars, resource: res.name || vars.resource }),
                instructions: fill(t.instructions, { ...vars, resource: res.name || vars.resource }),
                askKind: t.askKind || 'document',
                resourceId: res.id, resourceName: res.name,
                assignee: null,   // client asks aren't assigned to a Sphynx person
                included: true,
            });
        });
    });

    return plan;
}

// What differs between the confirmed plan and the SOP's current client-ask defaults: an SOP ask that was
// unchecked ('removed'), or an ask added that wasn't on the SOP ('added'). Exact membership only — no
// similarity matching, so it never mis-clusters two differently-worded asks. Used both to preview the
// changes (Smart SOP Updates prompt) and to log them at commit.
export function computeActivationOverrides(plan, ctx) {
    const defaults = pickAskTemplates(ctx.askTemplates, ctx.requestType, ctx.resourceType);
    const includedTemplateIds = new Set((plan || []).filter((r) => r.kind === 'ask' && r.included && r.templateId).map((r) => r.templateId));
    const overrides = [];
    defaults.forEach((t) => {
        if (!includedTemplateIds.has(t.id)) overrides.push({ action: 'removed', templateId: t.id, name: t.name || t.title });
    });
    (plan || []).filter((r) => r.kind === 'ask' && r.included && !r.templateId).forEach((r) => {
        overrides.push({ action: 'added', title: r.title, instructions: r.instructions || '', askKind: r.askKind });
    });
    return overrides;
}

// Applies the person's answers to the SOP. decisions: [{ override, scope: 'once'|'future' }]. Only 'future'
// changes anything: a 'removed' ask gets an exclusion for this request type (and resource type), so it stops
// being proposed for requests like this one; an 'added' ask becomes a new template for them. Returns the new
// template list (the caller saves it); never mutates the list it was given.
export function applySopUpdates(templates, decisions, ctx) {
    const list = (templates || []).map((t) => ({ ...t, excludeFor: [...(t.excludeFor || [])] }));
    (decisions || []).forEach(({ override, scope }) => {
        if (scope !== 'future' || !override) return;
        if (override.action === 'removed') {
            const t = list.find((x) => x.id === override.templateId);
            if (t) t.excludeFor.push({ requestType: ctx.requestType, resourceType: ctx.resourceType || '' });
        } else if (override.action === 'added') {
            list.push({
                id: 'at-' + ctx.uid(), name: override.title, requestTypes: [ctx.requestType],
                resourceTypes: isBlank(ctx.resourceType) ? [] : [ctx.resourceType], fallback: false,
                askKind: override.askKind || 'document', title: override.title, instructions: override.instructions || '',
            });
        }
    });
    return list;
}

// ---- committing the plan: create real tasks, link them, report what to log ----
// ctx: { requestId, requestType, resourceType, askTemplates, uid, now, clientTasks (array to push into) }.
// Returns { createdTaskIds, overrides }. Does NOT stamp item.activatedAt — same as listNewActivations in
// core/requests.js, that's the caller's job, done once the commit actually succeeds.
export function commitActivationPlan(plan, ctx) {
    const created = [];
    (plan || []).filter((row) => row.included).forEach((row) => {
        const task = {
            id: ctx.uid(), title: row.title, status: 'Open', createdAt: ctx.now,
            phase: row.kind === 'ask' ? 'before' : 'implementation',
            askKind: row.kind === 'ask' ? row.askKind : null,
            instructions: row.instructions || '',
            assignee: row.assignee || null,
            estimatedHours: row.estimatedHours || null,
            dueDate: row.dueDate || '',
            links: [],
        };
        addLink(task, ctx.requestId, row.resourceId ? [row.resourceId] : []);
        ctx.clientTasks.push(task);
        created.push(task.id);
    });

    const overrides = computeActivationOverrides(plan, ctx);

    return { createdTaskIds: created, overrides };
}

// Appends this activation's overrides to the master SOP-override log, for
// the periodic fold-back-into-the-SOP review. Stored on the master
// registry (alongside askTemplates), not per-client — it's about refining
// the shared template set, not this one client's history.
export function recordAskTemplateOverrides(log, overrides, ctx) {
    (overrides || []).forEach((o) => {
        log.push({ id: ctx.uid(), at: ctx.now, requestType: ctx.requestType, resourceType: ctx.resourceType, requestId: ctx.requestId, ...o });
    });
    return log;
}
