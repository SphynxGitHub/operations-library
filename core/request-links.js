//======================= CORE / REQUEST LINKS =======================//
// Finds the request(s) (scoping line) a task belongs to. A task points at its request(s) via task.links[] (see
// core/task-links.js); requestLineItemId is the legacy single-request field, still read as a fallback for any
// task that predates links[]. Pure functions.

import { linksForTask } from './task-links.js';

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

function findOneRequest(pd, lookup, requestId) {
    if (isBlank(requestId)) return null;

    // 1. Search across Scoping Sheets first
    for (const sheet of pd.scopingSheets || []) {
        const item = (sheet?.lineItems || []).find((i) => i && !isBlank(i.id) && String(i.id) === String(requestId));
        if (!item) continue;
        const resource = isBlank(item.resourceId) ? null : lookup(item.resourceId);
        const title = !isBlank(item.name) ? String(item.name).trim() : (resource?.name || '');
        return {
            itemId: String(item.id), sheetId: sheet.id === undefined ? '' : String(sheet.id), title: title || 'Request',
            requestType: isBlank(item.requestType) ? 'build' : String(item.requestType),
            round: Math.max(parseInt(item.round, 10) || 1, 1), status: String(item.status || ''),
            resourceName: resource?.name || '', isRequestLine: String(item.id).startsWith('reqline-') || (!resource && !isBlank(item.name)),
            isOnScopingSheet: true
        };
    }

    // 2. Fallback: Search standalone Client Requests (for requests not currently on a scoping sheet)
    const standaloneItem = (pd.clientRequests || []).find((r) => r && !isBlank(r.id) && String(r.id) === String(requestId));
    if (standaloneItem) {
        const resource = isBlank(standaloneItem.resourceId) ? null : lookup(standaloneItem.resourceId);
        const title = !isBlank(standaloneItem.name || standaloneItem.title) ? String(standaloneItem.name || standaloneItem.title).trim() : (resource?.name || '');
        return {
            itemId: String(standaloneItem.id), sheetId: '', title: title || 'Request',
            requestType: isBlank(standaloneItem.requestType) ? 'build' : String(standaloneItem.requestType),
            round: Math.max(parseInt(standaloneItem.round, 10) || 1, 1), status: String(standaloneItem.status || ''),
            resourceName: resource?.name || '', isRequestLine: false,
            isOnScopingSheet: false
        };
    }

    return null;
}

// resourceFor(id) -> { name, type } | null. It defaults to the project's own resources, then the master list.
// Returns one request object per link on the task (each carrying that link's resourceIds), in link order,
// skipping any link whose request can no longer be found. A task with no links at all returns [].
export function findRequestsForTask(client, task, resourceFor) {
    const pd = client?.projectData;
    if (!pd || !task) return [];
    const lookup = resourceFor || ((id) => (pd.localResources || []).find((r) => r.id === id) || null);

    return linksForTask(task)
        .map((link) => {
            const request = findOneRequest(pd, lookup, link.requestId);
            return request ? { ...request, resourceIds: link.resourceIds || [] } : null;
        })
        .filter(Boolean);
}

// Back-compat: the request a task belongs to, when it belongs to exactly one (or the first, for a task that
// now spans several). New code that needs to handle a multi-request task correctly should call
// findRequestsForTask instead — this wrapper exists so every existing single-request call site keeps working
// unchanged while each is moved over individually (see the call-site list in core/task-links.js).
export function findRequestForTask(client, task, resourceFor) {
    return findRequestsForTask(client, task, resourceFor)[0] || null;
}

// The name for the "resource" tag on a task row. Callers fill in "General Resource" when a task has none, which
// hides the truth for a task that belongs to a request on a resource, so the request's resource wins over that
// placeholder (but never over a name that was set deliberately).
export function resourceLabelForTask(task, request) {
    const named = !isBlank(task?.resourceName) && task.resourceName !== 'General Resource' ? task.resourceName : '';
    return named || request?.resourceName || task?.category || 'General Resource';
}
