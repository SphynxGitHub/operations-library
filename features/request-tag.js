//======================= FEATURES / REQUEST TAG =======================//
// A task that belongs to a request shows a tag for it (next to its resource tag), and clicking the tag jumps to
// that request on the client's scoping sheet. The logic is in core/request-links.js.

import { state, esc, getActiveClient, loadFullClient } from '../core/data.js';
import { findRequestForTask, resourceLabelForTask } from '../core/request-links.js';

const resourceLookup = (client) => (id) =>
    (client?.projectData?.localResources || []).find((r) => r.id === id) || (state.master?.resources || []).find((r) => r.id === id) || null;

function requestOf(task) {
    const client = state.clients?.[task?.clientId] || getActiveClient();
    return findRequestForTask(client, task, resourceLookup(client));
}

export function taskResourceLabel(task) {
    return resourceLabelForTask(task, requestOf(task));
}

export function renderRequestTagHTML(task) {
    const req = requestOf(task);
    if (!req) return '';
    const clientId = task.clientId || "";
    const label = req.title.length > 38 ? req.title.slice(0, 37) + '…' : req.title;
    const typeLabel = req.requestType.charAt(0).toUpperCase() + req.requestType.slice(1);
    return `<span class="pill tiny soft request-tag" title="${esc(typeLabel)} request, round ${esc(req.round)}. Click to open it on the scoping sheet."
                  style="font-size:10px; cursor:pointer; color:#64c6a2; background:rgba(100,198,162,0.08); border:1px solid rgba(100,198,162,0.25); display:inline-flex; align-items:center; gap:4px;"
                  onclick="event.stopPropagation(); OL.openRequestFromTask('${esc(clientId)}', '${esc(req.itemId)}')">
                <i data-lucide="git-pull-request" style="width:11px;height:11px; pointer-events:none;"></i>${esc(label)}
            </span>`;
}

// Jump to the client's scoping sheet and open the request there.
export async function openRequestFromTask(clientId, itemId) {
    try { if (typeof OL.closeModal === 'function') OL.closeModal(); } catch (e) { /* nothing open */ }
    if (clientId) await loadFullClient(clientId).catch(() => null);
    if (typeof OL.navigateToClientProject === 'function') OL.navigateToClientProject(clientId);
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
