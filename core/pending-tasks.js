//======================= CORE / PENDING TASKS =======================//
// Tasks prepared ahead of time for a request that is still pending (round 0 / Backlog). They live ON the request
// (item.pendingTasks), not in clientTasks, so nothing that lists, schedules or counts tasks can see them until the
// request is activated; activation then moves them into clientTasks (see applyPendingToPlan and
// commitActivationPlan in core/activation.js).
//
// Two kinds of row:
//   - template rows (custom: false) mirror the current templates: one implementation task per resource (or one for
//     the request) and the SOP's client asks. They are rebuilt from the templates every time syncPendingTasks runs,
//     so a changed template shows up on every pending request, and are never edited by hand.
//   - custom rows (custom: true) are added by a person (a client ask or a Sphynx task). They are never touched by
//     the sync.
// Either kind can carry blockedBy: [{ id }] pointing at other pending tasks of the same request. The sync keeps those
// on template rows (matched by key) and drops references to rows that no longer exist.

import { pickAskTemplates } from './activation.js';

const fill = (text, vars) => String(text ?? '').replace(/\{(resource|request)\}/g, (_, k) => vars[k] || '');

// The rows the templates call for right now. ctx: { resources, requestType, resourceType, askTemplates }.
export function desiredTemplateRows(item, ctx) {
    const title = item?.name || ctx.resources?.[0]?.name || 'Request';
    const targets = ctx.resources && ctx.resources.length ? ctx.resources : [{ id: null, name: title, type: ctx.resourceType }];
    const vars = { resource: ctx.resources?.[0]?.name || title, request: title };
    const rows = [];
    targets.forEach((res) => {
        rows.push({
            key: `impl:${res.id ?? 'req'}`, kind: 'implementation', templateId: null, custom: false,
            title: res.id ? `Build/revise ${res.name}` : `Work on ${title}`, instructions: '', askKind: null,
            resourceId: res.id ?? null, resourceName: res.name || '',
        });
    });
    targets.forEach((res) => {
        pickAskTemplates(ctx.askTemplates, ctx.requestType, res.type || ctx.resourceType).forEach((t) => {
            const v = { ...vars, resource: res.name || vars.resource };
            rows.push({
                key: `ask:${t.id}:${res.id ?? 'req'}`, kind: 'ask', templateId: t.id, custom: false,
                title: fill(t.title, v), instructions: fill(t.instructions, v), askKind: t.askKind || 'document',
                resourceId: res.id ?? null, resourceName: res.name || '',
            });
        });
    });
    return rows;
}

const FIELDS = ['title', 'instructions', 'askKind', 'resourceId', 'resourceName', 'templateId', 'kind'];

// Brings item.pendingTasks in line with the templates. Mutates the item; returns true when anything changed.
export function syncPendingTasks(item, ctx, uid) {
    if (!item) return false;
    const before = JSON.stringify(item.pendingTasks || null);
    const existing = Array.isArray(item.pendingTasks) ? item.pendingTasks : [];
    const desired = desiredTemplateRows(item, ctx);
    const byKey = new Map(existing.filter((p) => p && !p.custom && p.key).map((p) => [p.key, p]));
    const template = desired.map((d) => {
        const have = byKey.get(d.key);
        if (have) { FIELDS.forEach((f) => { have[f] = d[f]; }); return have; }
        return { id: uid(), ...d, blockedBy: [] };
    });
    const custom = existing.filter((p) => p && p.custom);
    const next = [...template, ...custom];
    const ids = new Set(next.map((p) => p.id));
    next.forEach((p) => { p.blockedBy = (p.blockedBy || []).filter((d) => d && ids.has(d.id) && d.id !== p.id); });
    item.pendingTasks = next;
    return JSON.stringify(item.pendingTasks) !== before;
}

// Activation: lets the prepared tasks drive the plan. Implementation rows keep the scheduling the plan worked out but
// take the prepared task's id (so dependencies still point at it) and its dependencies; every ask row, template or custom, comes
// from the prepared tasks; custom Sphynx tasks are added as implementation rows with no suggested date.
export function applyPendingToPlan(plan, pending, { assigneeFor } = {}) {
    if (!pending || !pending.length) return plan;
    const impl = (plan || []).filter((r) => r.kind === 'implementation');
    const out = [];
    pending.filter((p) => p.kind === 'implementation' && !p.custom).forEach((p) => {
        const row = impl.find((r) => String(r.resourceId ?? 'req') === String(p.resourceId ?? 'req'));
        if (row) out.push({ ...row, id: p.id, fromPending: true, blockedBy: p.blockedBy || [] });
    });
    // anything the plan proposed that has no prepared counterpart stays as proposed
    impl.forEach((r) => { if (!out.some((o) => String(o.resourceId ?? 'req') === String(r.resourceId ?? 'req'))) out.push(r); });
    pending.filter((p) => p.custom && p.kind !== 'ask').forEach((p) => {
        out.push({
            id: p.id, kind: 'implementation', templateId: null, title: p.title, instructions: p.instructions || '', askKind: null,
            resourceId: p.resourceId ?? null, resourceName: p.resourceName || '', assignee: assigneeFor ? assigneeFor() : '',
            estimatedHours: null, workSlots: null, dueDate: '', dueDateReason: null, reviewer: '', included: true,
            fromPending: true, blockedBy: p.blockedBy || [], custom: true,
        });
    });
    pending.filter((p) => p.kind === 'ask').forEach((p) => {
        out.push({
            id: p.id, kind: 'ask', templateId: p.custom ? null : p.templateId, title: p.title, instructions: p.instructions || '',
            askKind: p.askKind || 'document', resourceId: p.resourceId ?? null, resourceName: p.resourceName || '', assignee: null,
            included: true, fromPending: true, blockedBy: p.blockedBy || [], custom: !!p.custom,
        });
    });
    return out;
}
