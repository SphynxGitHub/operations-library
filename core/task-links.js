//======================= CORE / TASK LINKS =======================//
// A task's link(s) to the request(s) and, within each, the resource(s) it
// applies to. Replaces the old assumption that a task belongs to exactly one
// request (item.requestLineItemId / item.resourceId(s)).
//
// Shape:
//   task.links = [
//     { requestId: 'req-4', resourceIds: ['res-1'] },   // scoped to one resource on req-4
//     { requestId: 'req-7', resourceIds: [] }           // applies to req-7 as a whole
//   ]
//
// Why: some client tasks (a shared login, a brand asset) genuinely apply to
// more than one request at once, so a single requestLineItemId can't hold it.
//
// Backward compatibility: every existing task in the JSON still has
// requestLineItemId / resourceId / resourceIds and nothing else. Rather than
// migrate every record up front, linksForTask() synthesizes a links[] array
// on read from those legacy fields when task.links is absent. Every call site
// that currently reads task.requestLineItemId directly should be moved to
// linksForTask(task) instead, one call site at a time — see the call-site
// list at the bottom of this file.
//
// New tasks should be created with task.links[] directly (see makeLink /
// addLink below); requestLineItemId is written alongside it only as a
// denormalized "primary request" convenience for any display code that
// hasn't been moved over yet (e.g. "this task also touches 2 other
// requests"), never read back as the source of truth once links[] exists.

// A single, well-formed link entry.
export function makeLink(requestId, resourceIds = []) {
    return {
        requestId: String(requestId),
        resourceIds: Array.isArray(resourceIds) ? resourceIds.map(String) : [],
    };
}

// The canonical list of links for a task — task.links if present, else a
// single-entry array synthesized from the legacy fields. Never returns null;
// an unlinked/standalone task (e.g. General/Business Ops) returns [].
export function linksForTask(task) {
    if (!task) return [];
    if (Array.isArray(task.links)) return task.links;

    if (task.requestLineItemId) {
        const legacyResourceIds = Array.isArray(task.resourceIds)
            ? task.resourceIds
            : (task.resourceId ? [task.resourceId] : []);
        return [makeLink(task.requestLineItemId, legacyResourceIds)];
    }

    return [];
}

// True if this task applies to the given request at all (request-level or
// scoped to one of its resources).
export function taskAppliesToRequest(task, requestId) {
    return linksForTask(task).some((l) => l.requestId === String(requestId));
}

// True if this task applies to the given resource specifically (not just its
// parent request in general).
export function taskAppliesToResource(task, resourceId) {
    return linksForTask(task).some((l) => (l.resourceIds || []).includes(String(resourceId)));
}

// Every request id this task touches, in link order, de-duplicated.
export function requestIdsForTask(task) {
    const seen = new Set();
    const out = [];
    linksForTask(task).forEach((l) => {
        if (!seen.has(l.requestId)) { seen.add(l.requestId); out.push(l.requestId); }
    });
    return out;
}

// Keeps requestLineItemId/resourceId(s) mirroring links[0] — called after any
// add or remove so the legacy fields can never point at a link that's gone.
// An empty links[] clears them to null (an unlinked/standalone task).
function syncLegacyFields(task) {
    const primary = task.links[0] || null;
    task.requestLineItemId = primary ? primary.requestId : null;
    task.resourceIds = primary ? primary.resourceIds : [];
    task.resourceId = primary ? (primary.resourceIds[0] || null) : null;
    return task.links;
}

// Add a link (or, if the task already links to this request, merge the new
// resourceIds into the existing entry rather than creating a duplicate link
// for the same request). Mutates and returns task.links; also keeps
// requestLineItemId/resourceId(s) in sync as the legacy convenience fields
// for anything not yet reading via linksForTask.
export function addLink(task, requestId, resourceIds = []) {
    if (!Array.isArray(task.links)) task.links = linksForTask(task);

    const existing = task.links.find((l) => l.requestId === String(requestId));
    if (existing) {
        const merged = new Set([...(existing.resourceIds || []), ...resourceIds.map(String)]);
        existing.resourceIds = Array.from(merged);
    } else {
        task.links.push(makeLink(requestId, resourceIds));
    }

    return syncLegacyFields(task);
}

// Remove the task's entire link to a request (every resource scoping on it
// goes too). No-op, returns task.links unchanged, if the task isn't linked
// to that request. Re-syncs the legacy fields afterward — if the removed
// link was first, they shift to the new links[0], or clear to null if links
// is now empty.
export function removeLink(task, requestId) {
    if (!Array.isArray(task.links)) task.links = linksForTask(task);
    task.links = task.links.filter((l) => l.requestId !== String(requestId));
    return syncLegacyFields(task);
}

// Narrow a link instead of removing it outright: drop one resource from a
// request's resourceIds (the task still applies to the request, and to any
// other resources still listed) — e.g. an attachment answered two of three
// resources on a request and one gets unlinked without touching the other
// two. If this empties that link's resourceIds AND dropToRequestLevel is
// false (the default), the whole link is removed too, since a link that was
// only ever meant to scope specific resources shouldn't silently fall back
// to "applies to the whole request" on its own. Pass dropToRequestLevel:true
// when that fallback is actually what's wanted (e.g. the user explicitly
// chose "apply to the request as a whole" instead).
export function removeResourceFromLink(task, requestId, resourceId, dropToRequestLevel = false) {
    if (!Array.isArray(task.links)) task.links = linksForTask(task);

    const link = task.links.find((l) => l.requestId === String(requestId));
    if (!link) return syncLegacyFields(task);

    link.resourceIds = (link.resourceIds || []).filter((id) => id !== String(resourceId));
    if (link.resourceIds.length === 0 && !dropToRequestLevel) {
        task.links = task.links.filter((l) => l !== link);
    }

    return syncLegacyFields(task);
}

// Call sites still reading task.requestLineItemId directly, to move to
// linksForTask(task) / requestIdsForTask(task) one at a time:
//   - core/request-links.js   (findRequestForTask and friends)
//   - core/request-tasks.js   (phase/askKind grouping)
//   - core/work-status.js     (deriveWorkStatus's task lookup)
//   - features/business/tasks.js (scoping-sheet task list rendering)
// New code (the consolidated follow-up task, the activation-review screen,
// multi-request task creation and unlinking) should be written against
// linksForTask() / addLink() / removeLink() / removeResourceFromLink() from
// the start — never mutate task.links or the legacy fields by hand, so the
// two can never drift apart (see syncLegacyFields above).
