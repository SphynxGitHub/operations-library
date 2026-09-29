//======================= CORE / REQUEST BACKFILL =======================//
// Repairs scoping sheets that were built the old way (line items that point at resources, with no request
// data behind them) and are already in process, so their client tasks show up under the right request.
//
// Three things go wrong on those sheets, and this fixes each one:
//   1. The line has no request fields (requestType, resourceIds, round), so the request window and the
//      printed sheet read it as an empty request.
//   2. The client tasks that already exist belong to a RESOURCE (task.parentResourceId, task.resourceId(s),
//      or a resource's own dependencies list) but have no task.links[] entry, so tasksForRequest()
//      never finds them and "What we need from you" stays empty.
//   3. The line is Do Now in an approved round but was never activated, so the SOP's client asks were never
//      created. Only the CLIENT ASKS are created here (never the "Build/revise" task, since the work is
//      already under way), skipping any ask a linked task already covers, and the line is then stamped
//      activatedAt so it doesn't come up for activation review and create duplicates.
//
// Pure function on one client. The caller decides whether it runs on a copy (dry run) or inside
// updateAndSync (apply). Safe to run twice: everything it adds, it checks for first.

import { addLink, linksForTask } from './task-links.js';
import { requestResourceIds } from './request-pricing.js';
import { getCurrentRound, CONSOLIDATED_REQUEST_TYPES } from './requests.js';
import { isMaintenanceSheet } from './maintenance.js';
import { buildActivationPlan, commitActivationPlan } from './activation.js';
import { tasksForRequest } from './request-tasks.js';

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const lc = (v) => String(v ?? '').trim().toLowerCase();
const isPlaceholderResource = (id) => String(id || '').startsWith('reqline-');

// ctx: { askTemplates, roles, assigneeByType, uid, now, lookupResource(id), activate }
// Mutates client.projectData and returns a report of what changed.
export function backfillClientRequests(client, ctx) {
    const report = { clientId: client?.id, clientName: client?.meta?.name || '', normalized: [], linked: [], ambiguous: [], asksCreated: [], activated: [] };
    const pd = client?.projectData;
    if (!pd) return report;
    if (!Array.isArray(pd.clientTasks)) pd.clientTasks = [];
    const tasks = pd.clientTasks;
    const localResources = pd.localResources || [];
    const lookup = ctx.lookupResource || ((id) => localResources.find((r) => r.id === id) || null);

    // ---- the real lines on each (non-maintenance) sheet ----
    const lines = [];   // { sheet, item, title }
    (pd.scopingSheets || []).forEach((sheet) => {
        if (!sheet || isMaintenanceSheet(sheet)) return;
        (sheet.lineItems || []).forEach((item) => {
            if (!item || typeof item !== 'object' || isBlank(item.id)) return;
            const status = String(item.status || '');
            if (status === 'Backlog' || /^Don.t Do$/i.test(status)) return;
            const resource = isBlank(item.resourceId) ? null : lookup(item.resourceId);
            const title = !isBlank(item.name) ? String(item.name).trim() : (resource?.name || '');
            if (!title) return;   // empty shell: no name and the resource is gone
            lines.push({ sheet, item, title });
        });
    });

    // ---- 1. give each line its request fields ----
    lines.forEach(({ item }) => {
        const changes = [];
        const folded = CONSOLIDATED_REQUEST_TYPES[item.requestType];
        if (isBlank(item.requestType)) { item.requestType = 'build'; changes.push('requestType=build'); }
        else if (folded) { changes.push(`requestType ${item.requestType} -> ${folded}`); item.requestType = folded; }
        if (!Array.isArray(item.resourceIds)) {
            const ids = requestResourceIds(item);
            if (ids.length) { item.resourceIds = ids; changes.push(`resourceIds=[${ids.length}]`); }
        }
        const status = String(item.status || '');
        if ((status === 'Do Now' || status === 'Do Later' || status === 'Done') && !(parseInt(item.round, 10) >= 1)) {
            item.round = 1; changes.push('round=1');
        }
        if (changes.length) report.normalized.push({ request: item.name || item.id, changes });
    });

    // ---- 2. link the tasks that belong to a resource but not to a request ----
    // Which resource(s) each unlinked task belongs to: its own fields, plus any resource that lists it as a dependency.
    const taskResources = new Map();   // taskId -> Set(resourceId)
    const addRes = (taskId, resId) => {
        if (isBlank(taskId) || isBlank(resId)) return;
        const k = String(taskId);
        if (!taskResources.has(k)) taskResources.set(k, new Set());
        taskResources.get(k).add(String(resId));
    };
    tasks.forEach((t) => {
        if (!t) return;
        addRes(t.id, t.parentResourceId);
        addRes(t.id, t.resourceId);
        (Array.isArray(t.resourceIds) ? t.resourceIds : []).forEach((rid) => addRes(t.id, rid));
    });
    localResources.forEach((r) => (r?.dependencies || []).forEach((d) => { if (d && d.type === 'task') addRes(d.id, r.id); }));

    // Which request a resource points at. The current round's Do Now line wins; otherwise a resource with exactly
    // one line is unambiguous; anything else is reported and left alone rather than guessed.
    const currentBySheet = new Map(lines.map(({ sheet }) => [sheet, getCurrentRound({ lineItems: lines.filter((l) => l.sheet === sheet).map((l) => l.item), roundApprovals: sheet.roundApprovals, status: sheet.status })]));
    const isCurrentDoNow = ({ sheet, item }) => {
        const r = parseInt(item.round, 10);
        return String(item.status || '') === 'Do Now' && currentBySheet.get(sheet) !== null && (Number.isFinite(r) && r >= 1 ? r : 1) === currentBySheet.get(sheet);
    };
    const requestForResource = (resId) => {
        const candidates = lines.filter((l) => requestResourceIds(l.item).includes(String(resId)));
        if (candidates.length === 1) return candidates[0];
        const current = candidates.filter(isCurrentDoNow);
        return current.length === 1 ? current[0] : null;
    };

    tasks.forEach((t) => {
        if (!t || t.consolidatedFollowUp || linksForTask(t).length) return;   // already linked (or the follow-up, which is never on a request)
        const resIds = taskResources.get(String(t.id));
        if (!resIds || !resIds.size) return;
        const byRequest = new Map();   // request id -> resource ids for it
        const unresolved = [];
        resIds.forEach((resId) => {
            const line = requestForResource(resId);
            if (!line) { if (lines.some((l) => requestResourceIds(l.item).includes(resId))) unresolved.push(resId); return; }
            const rid = String(line.item.id);
            if (!byRequest.has(rid)) byRequest.set(rid, []);
            byRequest.get(rid).push(resId);
        });
        byRequest.forEach((resourceIds, requestId) => addLink(t, requestId, resourceIds));
        if (byRequest.size) {
            // A client's own task with no phase reads as "During"; it belongs under "Before" like every other ask.
            if (isBlank(t.phase) && !t.askKind && (t.isClientTask || t.assignee === 'Client Task')) t.phase = 'before';
            report.linked.push({ task: t.title || t.name || t.id, requests: [...byRequest.keys()] });
        }
        if (unresolved.length) report.ambiguous.push({ task: t.title || t.name || t.id, resources: unresolved });
    });

    // ---- 3. create the client asks the SOP would have made, for lines already in progress ----
    if (ctx.activate !== false) {
        lines.forEach((line) => {
            const { item } = line;
            if (!isCurrentDoNow(line) || item.activatedAt) return;
            const resources = requestResourceIds(item).map((id) => lookup(id)).filter(Boolean);
            const requestType = isBlank(item.requestType) ? 'build' : String(item.requestType);
            const resourceType = resources[0]?.type || '';
            const plan = buildActivationPlan({
                item, resources, requestType, resourceType, askTemplates: ctx.askTemplates,
                client, roles: ctx.roles || [], assigneeByType: ctx.assigneeByType || {}, uid: ctx.uid,
            });
            // Client asks only, and none that a task already on this request covers.
            const have = new Set(tasksForRequest(client, item).map((t) => lc(t.title || t.name)));
            plan.forEach((row) => { row.included = row.kind === 'ask' && !have.has(lc(row.title)); });
            const result = commitActivationPlan(plan, {
                requestId: item.id, requestType, resourceType, askTemplates: ctx.askTemplates,
                uid: ctx.uid, now: ctx.now, clientTasks: tasks,
            });
            item.activatedAt = ctx.now;
            report.activated.push(item.name || line.title);
            if (result.createdTaskIds.length) report.asksCreated.push({ request: item.name || line.title, count: result.createdTaskIds.length });
        });
    }

    return report;
}
