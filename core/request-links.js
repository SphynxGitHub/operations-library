//======================= CORE / REQUEST LINKS =======================//
// Finds the request (scoping line) a task belongs to. A task points at its request with requestLineItemId, which
// is set for step tasks, client asks, testing and fix tasks, and client-review tasks. Pure functions.

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

// resourceFor(id) -> { name, type } | null. It defaults to the project's own resources, then the master list.
export function findRequestForTask(client, task, resourceFor) {
    const pd = client?.projectData;
    if (!pd || !task || isBlank(task.requestLineItemId)) return null;
    const lookup = resourceFor || ((id) => (pd.localResources || []).find((r) => r.id === id) || null);
    for (const sheet of pd.scopingSheets || []) {
        const item = (sheet?.lineItems || []).find((i) => i && !isBlank(i.id) && String(i.id) === String(task.requestLineItemId));
        if (!item) continue;
        const resource = isBlank(item.resourceId) ? null : lookup(item.resourceId);
        const title = !isBlank(item.name) ? String(item.name).trim() : (resource?.name || '');
        return {
            itemId: String(item.id), sheetId: sheet.id === undefined ? '' : String(sheet.id), title: title || 'Request',
            requestType: isBlank(item.requestType) ? 'build' : String(item.requestType),
            round: Math.max(parseInt(item.round, 10) || 1, 1), status: String(item.status || ''),
            resourceName: resource?.name || '', isRequestLine: String(item.id).startsWith('reqline-') || (!resource && !isBlank(item.name)),
        };
    }
    return null;
}

// The name for the "resource" tag on a task row. Callers fill in "General Resource" when a task has none, which
// hides the truth for a task that belongs to a request on a resource, so the request's resource wins over that
// placeholder (but never over a name that was set deliberately).
export function resourceLabelForTask(task, request) {
    const named = !isBlank(task?.resourceName) && task.resourceName !== 'General Resource' ? task.resourceName : '';
    return named || request?.resourceName || task?.category || 'General Resource';
}
