//======================= CORE / RESOURCE STATUS =======================//
// A resource's own status, kept in step with the requests and tasks that cover it:
//
//   Pending     when a resource is first created (and whenever it is not part of any live request)
//   In Process  once it is part of a Do Now request in a working round that has been Approved
//   Built       once every implementation task for it (or for the request it is on) is done
//   In Review   when a Built resource is added to a Revise request; back to Built when that request closes
//
// Only these transitions are automatic. A status someone sets by hand stays until one of the rules above
// applies to it. A resource that is on no request keeps whatever it has (shown through normalizeResourceStatus,
// so an older value like "Pending Sphynx Action" reads as Pending and "Done" reads as Built).
// Pure functions on one client's project JSON.

import { requestResourceIds } from './request-pricing.js';
import { roundStatusOf, CONSOLIDATED_REQUEST_TYPES } from './requests.js';
import { isMaintenanceSheet } from './maintenance.js';
import { linksForTask } from './task-links.js';
import { isTaskClosed } from './work-status.js';
import { tasksForRequest, taskPhase, isClientFacing } from './request-tasks.js';

export const RESOURCE_STATUSES = ['Pending', 'In Process', 'Built', 'In Review'];
export const RESOURCE_STATUS_COLORS = { 'Pending': '#94a3b8', 'In Process': '#38bdf8', 'Built': '#64c6a2', 'In Review': '#f59e0b' };

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

// Any stored value -> one of the four. Older values came from the task status list.
export function normalizeResourceStatus(v) {
    const s = String(v ?? '').trim();
    if (RESOURCE_STATUSES.includes(s)) return s;
    if (/review/i.test(s)) return 'In Review';
    if (/done|complete|built|live|launched/i.test(s)) return 'Built';
    if (/progress|process|working|building|active/i.test(s)) return 'In Process';
    return 'Pending';
}

// References are look-up material, not work: they have no status (same test as OL.isReferenceResource).
export const isReferenceResource = (r) => !!r && (r.type === 'Reference' || r.type === 'Admin' || !!r.systemPinned || !!r.adminPinned);

// Every request (scoping line) that covers this resource, with where its round stands.
function requestsCovering(client, resourceId) {
    const out = [];
    (client?.projectData?.scopingSheets || []).forEach((sheet) => {
        if (!sheet || isMaintenanceSheet(sheet)) return;
        (sheet.lineItems || []).forEach((item) => {
            if (!item || isBlank(item.id) || !requestResourceIds(item).includes(String(resourceId))) return;
            const status = String(item.status || '');
            if (!['Do Now', 'Done'].includes(status)) return;          // Do Later, Don't Do and Pending never count
            const r = parseInt(item.round, 10);
            const type = CONSOLIDATED_REQUEST_TYPES[item.requestType] || (isBlank(item.requestType) ? 'build' : String(item.requestType));
            out.push({ item, status, type, roundStatus: roundStatusOf(sheet, Number.isFinite(r) && r >= 1 ? r : 1) });
        });
    });
    return out;
}

// The implementation tasks that apply to this resource on this request: During-phase, Sphynx's own, and either
// scoped to this resource or to the request as a whole.
function implementationTasks(client, req, resourceId, ctx) {
    return tasksForRequest(client, req.item).filter((t) => {
        if (!t || t.consolidatedFollowUp) return false;
        if (taskPhase(t, req.item) !== 'implementation' || isClientFacing(t, ctx)) return false;
        const link = linksForTask(t).find((l) => String(l.requestId) === String(req.item.id));
        if (!link) return false;                                       // a linked meeting's action item, not a step
        const ids = (link.resourceIds || []).map(String);
        return ids.length === 0 || ids.includes(String(resourceId));
    });
}

// The status this resource should have now, given the one it has. ctx: { closedNames, sphynxNames }
export function nextResourceStatus(client, resource, ctx = {}) {
    const current = normalizeResourceStatus(resource?.status);
    const reqs = requestsCovering(client, resource.id);
    if (!reqs.length) return current;
    const closed = ctx.closedNames && ctx.closedNames.length ? ctx.closedNames : ['Done'];

    const reviseOpen = reqs.some((q) => q.type === 'revision' && q.status === 'Do Now' && ['Drafting', 'Approved'].includes(q.roundStatus));
    const inApprovedRound = reqs.some((q) => q.status === 'Do Now' && q.roundStatus === 'Approved');
    const builtNow = reqs.some((q) => {
        if (q.type === 'revision' || q.type === 'training') return false;
        if (!['Approved', 'Complete'].includes(q.roundStatus)) return false;
        if (q.status === 'Done') return true;
        const steps = implementationTasks(client, q, resource.id, ctx);
        return steps.length > 0 && steps.every((t) => isTaskClosed(t, closed));
    });

    let s = current;
    if (s === 'In Review' && !reviseOpen) s = 'Built';
    if (s === 'Built' && reviseOpen) s = 'In Review';
    if (s === 'Pending' && inApprovedRound) s = 'In Process';
    if ((s === 'Pending' || s === 'In Process') && builtNow) s = 'Built';
    return s;
}

// Applies it to every non-reference local resource. Returns [{ resource, from, to }] for what changed.
export function syncResourceStatuses(client, ctx = {}) {
    const changes = [];
    (client?.projectData?.localResources || []).forEach((res) => {
        if (!res || isBlank(res.id) || isReferenceResource(res) || res.isRequestLine || String(res.id).startsWith('reqline-')) return;
        const from = normalizeResourceStatus(res.status);
        const to = nextResourceStatus(client, res, ctx);
        if (to !== from) { res.status = to; changes.push({ resource: res.name || res.id, from, to }); }
    });
    return changes;
}
