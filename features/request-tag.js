//======================= FEATURES / REQUEST TAG =======================//
// A task that belongs to a request shows a tag for it (next to its resource tag), and clicking the tag jumps to
// that request on the client's scoping sheet. A task can belong to more than one request (task.links[] —
// core/task-links.js), e.g. a shared login ask that gates several requests at once, so this renders one tag
// per link, not just the first. The logic is in core/request-links.js.

import { state, esc, getActiveClient, loadFullClient } from '../core/data.js';
import { findRequestsForTask, resourceLabelForTask } from '../core/request-links.js';

const resourceLookup = (client) => (id) =>
    (client?.projectData?.localResources || []).find((r) => r.id === id) || (state.master?.resources || []).find((r) => r.id === id) || null;

function requestsOf(task) {
    const client = state.clients?.[task?.clientId] || getActiveClient();
    return findRequestsForTask(client, task, resourceLookup(client));
}

export function taskResourceLabel(task) {
    // Resource label still reflects a single request for display purposes (the tag row below shows every
    // request separately) — the first linked request's resource is the best single answer here.
    return resourceLabelForTask(task, requestsOf(task)[0] || null);
}

function oneTagHTML(task, req) {
    const clientId = task.clientId || "";
    const label = req.title.length > 38 ? req.title.slice(0, 37) + '…' : req.title;
    const typeLabel = req.requestType.charAt(0).toUpperCase() + req.requestType.slice(1);
    return `<span class="pill tiny soft request-tag" title="${esc(typeLabel)} request, round ${esc(req.round)}. Click to open it on the scoping sheet."
                  style="font-size:10px; cursor:pointer; color:#64c6a2; background:rgba(100,198,162,0.08); border:1px solid rgba(100,198,162,0.25); display:inline-flex; align-items:center; gap:4px;"
                  onclick="event.stopPropagation(); OL.openRequestFromTask('${esc(clientId)}', '${esc(req.itemId)}')">
                <i data-lucide="git-pull-request" style="width:11px;height:11px; pointer-events:none;"></i>${esc(label)}
            </span>`;
}

export function renderRequestTagHTML(task) {
    const reqs = requestsOf(task);
    if (!reqs.length) return '';
    return reqs.map((req) => oneTagHTML(task, req)).join(' ');
}

// Jump to the client's scoping sheet and open the request there.
export async function openRequestFromTask(clientId, itemId) {
    try { if (typeof OL.closeModal === 'function') OL.closeModal(); } catch (e) { /* nothing open */ }
    if (clientId) await loadFullClient(clientId).catch(() => null);
    if (typeof OL.navigateToClientProject === 'function') OL.navigateToClientProject(clientId);
    const client0 = state.clients?.[clientId];
    const onMaintenanceSheet = (client0?.projectData?.scopingSheets || []).some((sh) => (sh?.kind === 'maintenance' || sh?.id === 'maintenance') && (sh.lineItems || []).some((it) => String(it.id) === String(itemId)));
    if (onMaintenanceSheet) {                          // a client request: it lives on the Client Requests page
        if (typeof window !== 'undefined') window.location.hash = '#/client-requests';
        const waitReq = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 20; i++) { await waitReq(150); if (document.getElementById('mainContent')?.textContent?.includes('Client Requests')) break; }
        if (typeof OL.openMaintenanceRequestModal === 'function') OL.openMaintenanceRequestModal(itemId);
        return;
    }
    if (typeof window !== 'undefined') window.location.hash = '#/scoping-sheet';
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 20; i++) {                    // wait up to about 3 seconds for the scoping sheet to draw
        await wait(150);
        if (document.getElementById('scoping-search-input')) break;
    }
    const client = state.clients?.[clientId];
    const item = (client?.projectData?.scopingSheets?.[0]?.lineItems || []).find((it) => String(it.id) === String(itemId));
    if (!item) return;
    const isRequestLine = String(item.id).startsWith('reqline-') || (!item.resourceId && item.name);
    if (isRequestLine && typeof OL.openRequestLineModal === 'function') OL.openRequestLineModal(item.id);
    else if (typeof OL.openResourceModal === 'function') OL.openResourceModal(item.id);
}

window.OL = window.OL || {};
Object.assign(window.OL, { taskResourceLabel, renderRequestTagHTML, openRequestFromTask });
