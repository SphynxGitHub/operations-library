//======================= CORE / REQUEST BACKFILL =======================//
// Brings scoping sheets built the old way (lines that point at a resource, with no request data behind them) up
// to the request model. For every line in a working round that is NOT Complete:
//   1. it becomes a request line, the same shape "Add Request" makes: titled (from its resource), typed (Build unless
//      it says otherwise), carrying its own placeholder id (item.resourceId = 'reqline-...') with the resource it
//      used to point at listed under item.resourceIds, plus a round and the date it came in. Any units set on the
//      line itself move onto that resource, so the price does not change;
//   2. the client tasks that already exist for its resource (task.parentResourceId, task.resourceId(s), or the
//      resource's own dependencies list) are linked to it via task.links[], so they show under the request;
//   3. resource statuses are brought in line with the rules in core/resource-status.js.
// NO tasks are created: the request's tasks come at activation. Rounds marked Complete are left alone, and so are
// Pending (Backlog) and Don't Do lines.
//
// Pure function on one client. The caller decides whether it runs on a copy (dry run) or inside updateAndSync
// (apply). Safe to run twice: everything it adds, it checks for first.

import { addLink, linksForTask } from './task-links.js';
import { requestResourceIds } from './request-pricing.js';
import { getCurrentRound, roundStatusOf, CONSOLIDATED_REQUEST_TYPES } from './requests.js';
import { isMaintenanceSheet, maintenanceSheetOf } from './maintenance.js';
import { syncResourceStatuses } from './resource-status.js';

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const isPlaceholderResource = (id) => String(id || '').startsWith('reqline-');
const newPlaceholder = () => 'reqline-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ctx: { lookupResource(id), closedNames, sphynxNames }
export function backfillClientRequests(client, ctx = {}) {
    const report = {
        clientId: client?.id, clientName: client?.meta?.name || '',
        normalized: [], notConverted: [], linked: [], ambiguous: [], unresolved: [], skippedComplete: 0, resourceStatuses: [], maintenanceOpen: 0,
    };
    const pd = client?.projectData;
    if (!pd) return report;
    const tasks = Array.isArray(pd.clientTasks) ? pd.clientTasks : [];
    const localResources = pd.localResources || [];
    const lookup = ctx.lookupResource || ((id) => localResources.find((r) => r.id === id) || null);

    // Requests still kept on the old maintenance sheet or the standalone list have no home once the Client
    // Requests tab is gone. They are counted, never moved silently — see OL.migrateClientRequestsToBacklog.
    const open = (i) => i && !['Done', "Don't Do"].includes(String(i.status || ''));
    report.maintenanceOpen = ((maintenanceSheetOf(pd)?.lineItems || []).filter(open).length) + ((pd.clientRequests || []).filter(open).length);

    // ---- the lines to work on ----
    const lines = [];   // { sheet, item, title }
    (pd.scopingSheets || []).forEach((sheet) => {
        if (!sheet || isMaintenanceSheet(sheet)) return;
        (sheet.lineItems || []).forEach((item) => {
            if (!item || typeof item !== 'object' || isBlank(item.id)) return;
            const status = String(item.status || '');
            if (status === 'Backlog' || /^Don.t Do$/i.test(status)) return;
            const r = parseInt(item.round, 10);
            if (roundStatusOf(sheet, Number.isFinite(r) && r >= 1 ? r : 1) === 'Complete') { report.skippedComplete++; return; }
            const resource = isBlank(item.resourceId) ? null : lookup(item.resourceId);
            const title = !isBlank(item.name) ? String(item.name).trim() : (resource?.name || '');
            if (!title) { report.unresolved.push({ line: item.id, resourceId: item.resourceId || '' }); return; }   // reported, never guessed
            lines.push({ sheet, item, title });
        });
    });

    // ---- 1. each line becomes a request ----
    lines.forEach(({ item }) => {
        const changes = [];
        const resource = isBlank(item.resourceId) ? null : lookup(item.resourceId);
        if (isBlank(item.name) && resource && !isPlaceholderResource(item.resourceId) && !isBlank(resource.name)) {
            item.name = String(resource.name).trim(); changes.push('title from resource');
        }
        const folded = CONSOLIDATED_REQUEST_TYPES[item.requestType];
        if (isBlank(item.requestType)) { item.requestType = 'build'; changes.push('type=build'); }
        else if (folded) { changes.push(`type ${item.requestType} -> ${folded}`); item.requestType = folded; }
        // The request stops being the resource: it gets its own placeholder id, and the resource(s) it used to point
        // at are listed as what it covers. Units set on the line move onto the resource (the same numbers, so the
        // fee is unchanged). A resource that isn't one of this project's own can't take them, so that line is left
        // as it was and reported.
        if (!isPlaceholderResource(item.resourceId)) {
            const covered = requestResourceIds(item).filter((id) => !isPlaceholderResource(id));
            const main = localResources.find((r) => String(r.id) === String(item.resourceId));
            if (isBlank(item.resourceId) || !covered.length) {
                // nothing to cover: leave it
            } else if (!main) {
                report.notConverted.push({ line: item.id, resourceId: item.resourceId, why: 'its resource is not one of this project\'s own resources' });
            } else {
                const units = item.data && typeof item.data === 'object' ? item.data : {};
                if (Object.keys(units).length) { main.data = { ...(main.data || {}), ...units }; item.data = {}; }
                item.resourceIds = covered;
                item.resourceId = newPlaceholder();
                changes.push(`covers ${covered.length} resource${covered.length === 1 ? '' : 's'}`);
            }
        } else if (!Array.isArray(item.resourceIds)) {
            item.resourceIds = [];
        }
        const status = String(item.status || '');
        if (['Do Now', 'Do Later', 'Done'].includes(status) && !(parseInt(item.round, 10) >= 1)) { item.round = 1; changes.push('round=1'); }
        // When it came in: the line's own creation time, or the time in its id (li-<ms>). Never today's date.
        if (isBlank(item.receivedAt)) {
            const fromId = /^li-(\d{12,})$/.exec(String(item.id));
            const at = !isBlank(item.createdDate) ? String(item.createdDate) : (fromId ? new Date(Number(fromId[1])).toISOString() : '');
            if (at && !Number.isNaN(Date.parse(at))) { item.receivedAt = at.slice(0, 10); changes.push('received date'); }
        }
        if (changes.length) report.normalized.push({ request: item.name || item.id, changes });
    });

    // ---- 2. link existing tasks that belong to a resource but not to a request ----
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

    // A resource on exactly one request is unambiguous. On several, the current round's Do Now request wins.
    // Anything else is reported and left alone rather than guessed.
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
        const byRequest = new Map();
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
            if (isBlank(t.phase) && !t.askKind && (t.isClientTask || t.assignee === 'Client Task')) t.phase = 'before';
            report.linked.push({ task: t.title || t.name || t.id, requests: [...byRequest.keys()] });
        }
        if (unresolved.length) report.ambiguous.push({ task: t.title || t.name || t.id, resources: unresolved });
    });

    // ---- 3. resource statuses ----
    report.resourceStatuses = syncResourceStatuses(client, { closedNames: ctx.closedNames, sphynxNames: ctx.sphynxNames });

    return report;
}
