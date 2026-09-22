//======================= FEATURES / REQUEST RESOURCES =======================//
// The "Resources" section of the request window. A request can cover several resources: real ones from the project,
// or "shell" resources that stand in for what is going to be built. Each resource is priced by its own type and its
// own units, which are set on the resource itself ("Set units" opens it). The request's fee is the total.
// The pricing itself is in core/request-pricing.js and the scoping sheet's fee functions.

import { state, esc, getActiveClient } from '../core/data.js';
import { requestResourceIds, renderRequestResourcesHtml, REQUEST_RESOURCES_CSS } from '../core/request-pricing.js';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;
const isRequestLineId = (id) => String(id || '').startsWith('reqline-');
const DEFAULT_TYPES = ['Zap', 'Form', 'Email', 'Event', 'General'];

function resourceIn(client, id) {
    return (client?.projectData?.localResources || []).find((r) => String(r.id) === String(id))
        || (state.master?.resources || []).find((r) => String(r.id) === String(id)) || null;
}

export function requestResourcesSectionHtml(client, item) {
    if (!client || !item) return '';
    const breakdown = typeof OL.getRequestPriceBreakdown === 'function' ? OL.getRequestPriceBreakdown(item) : { lines: [], gross: 0, hoursFee: 0, hours: 0 };
    const ids = requestResourceIds(item);
    const shown = breakdown.lines.filter((l) => !isRequestLineId(l.resourceId));
    const onRequest = new Set(ids);
    const spare = (client.projectData?.localResources || []).filter((r) => r && !onRequest.has(String(r.id)) && !String(r.id).startsWith('step-'));
    const types = (state.master?.resourceTypes || []).map((t) => t.type).filter(Boolean);
    const typeOptions = (types.length ? types : DEFAULT_TYPES).map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    const removable = (id) => !(String(id) === String(item.resourceId) && (ids.length < 2 || isRequestLineId(item.resourceId)));

    const rows = shown.map((l) => {
        const res = resourceIn(client, l.resourceId);
        const units = l.units.length ? l.units.map((u) => `${u.count} ${esc(u.label)} × ${money(u.value)}`).join(' · ') : 'no units set yet';
        return `
            <div class="rq-res-row" style="display:flex; align-items:center; gap:8px; padding:7px 9px; border:1px solid var(--line); border-radius:6px;">
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        <strong style="font-size:12px;">${esc(l.name || 'Untitled')}</strong>
                        <span class="pill tiny soft" style="font-size:9px;">${esc(l.type || 'General')}</span>
                        ${l.isShell ? '<span class="pill tiny" style="font-size:9px; border:1px solid #f59e0b; color:#f59e0b;">Planned</span>' : ''}
                    </div>
                    <div class="tiny muted">${units}</div>
                </div>
                <strong style="font-size:12px; flex-shrink:0;">${money(l.fee)}</strong>
                <button type="button" class="btn tiny soft" onclick="OL.rqSetUnits('${esc(itemIdOf(item))}', '${esc(l.resourceId)}')">Set units</button>
                ${res ? `<select class="modal-input tiny" style="width:auto; flex-shrink:0;" title="Planned: not built yet. Built: it exists." onchange="OL.rqSetBuildState('${esc(itemIdOf(item))}', '${esc(l.resourceId)}', this.value)">
                    <option value="planned" ${l.isShell ? 'selected' : ''}>Planned</option>
                    <option value="built" ${l.isShell ? '' : 'selected'}>Built</option>
                </select>` : ''}
                ${removable(l.resourceId) ? `<button type="button" class="btn tiny soft" title="Take it off this request" onclick="OL.rqRemoveResource('${esc(itemIdOf(item))}', '${esc(l.resourceId)}')">✕</button>` : ''}
            </div>`;
    }).join('');

    const hoursRow = breakdown.hoursFee > 0 ? `
            <div style="display:flex; justify-content:space-between; padding:4px 9px;" class="tiny"><span>Estimated time (${esc(breakdown.hours)} h)</span><strong>${money(breakdown.hoursFee)}</strong></div>` : '';

    return `
        <div id="rq-resources" style="display:flex; flex-direction:column; gap:6px; margin-bottom:16px;">
            <label class="tiny muted" style="font-size:10px; font-weight:600;">Resources <span style="font-weight:400;">(the fee is the total of what it covers; units are set on each resource)</span></label>
            ${rows || '<div class="tiny muted">No resources yet. This request is priced by its estimated hours.</div>'}
            ${hoursRow}
            <div style="display:flex; justify-content:flex-end; padding:2px 9px;" class="tiny"><span class="muted" style="margin-right:8px;">Total before discount</span><strong>${money(breakdown.gross)}</strong></div>
            <div style="display:flex; gap:6px; align-items:center;">
                <select id="rq-add-existing" class="modal-input tiny" style="flex:1; min-width:0;">
                    <option value="">Add an existing resource...</option>
                    ${spare.map((r) => `<option value="${esc(r.id)}">${esc(r.name || 'Untitled')}${r.type ? ' (' + esc(r.type) + ')' : ''}${r.isShell ? ' - planned' : ''}</option>`).join('')}
                </select>
                <button type="button" class="btn tiny soft" onclick="OL.rqAddExistingResource('${esc(itemIdOf(item))}')">Add</button>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
                <input id="rq-shell-name" type="text" class="modal-input tiny" style="flex:1; min-width:0;" placeholder="Or plan a new resource, e.g. Intake form">
                <select id="rq-shell-type" class="modal-input tiny" style="width:auto;">${typeOptions}</select>
                <button type="button" class="btn tiny soft" onclick="OL.rqAddShell('${esc(itemIdOf(item))}')">Add planned</button>
            </div>
        </div>`;
}

const itemIdOf = (item) => String(item.id);

// ---------------- the actions ----------------
function findItem(itemId) {
    const client = getActiveClient();
    if (!client || !client.projectData) return { client: null, item: null };

    // 1. Search scoping sheets
    let item = (client.projectData.scopingSheets || [])
        .flatMap((s) => s?.lineItems || [])
        .find((i) => i && String(i.id) === String(itemId));

    // 2. Fallback: Search standalone client requests
    if (!item) {
        item = (client.projectData.clientRequests || []).find((r) => r && String(r.id) === String(itemId));
    }

    // 3. Fallback: Search local resources
    if (!item) {
        item = (client.projectData.localResources || []).find((r) => r && String(r.id) === String(itemId));
    }

    return { client, item };
}

// Keep what has been typed in the window, change the resources, save, and draw the window again.
async function changeResources(itemId, change) {
    const { client, item } = findItem(itemId);
    if (!client || !item) return false;
    if (typeof OL.applyRequestFormToItem === 'function') OL.applyRequestFormToItem(item);
    const result = change(client, item);
    if (result === false) { OL.openRequestLineModal(itemId); return false; }
    if (typeof OL.persist === 'function') await OL.persist();
    OL.openRequestLineModal(itemId);
    if (typeof document !== 'undefined' && document.getElementById('scoping-search-input') && typeof window.renderScopingSheet === 'function') window.renderScopingSheet();
    return true;
}

export async function rqAddExistingResource(itemId) {
    const id = document.getElementById('rq-add-existing')?.value;
    if (!id) return;
    return changeResources(itemId, (client, item) => {
        const ids = requestResourceIds(item);
        if (ids.includes(String(id)) || !resourceIn(client, id)) return false;
        item.resourceIds = [...ids, String(id)];
    });
}

export async function rqAddShell(itemId) {
    const name = String(document.getElementById('rq-shell-name')?.value || '').trim();
    const type = document.getElementById('rq-shell-type')?.value || 'General';
    if (!name) { alert('Give the planned resource a name.'); return; }
    return changeResources(itemId, (client, item) => {
        if (!client.projectData.localResources) client.projectData.localResources = [];
        const id = `local-prj-${Date.now()}${Math.floor(Math.random() * 1000)}`;
        client.projectData.localResources.push({
            id, name, type, archetype: 'Base', integration: null, data: {}, steps: [], triggers: [],
            createdDate: new Date().toISOString(), isShell: true,
        });
        item.resourceIds = [...requestResourceIds(item), id];
    });
}

export async function rqRemoveResource(itemId, resourceId) {
    return changeResources(itemId, (client, item) => {
        const ids = requestResourceIds(item);
        const id = String(resourceId);
        if (!ids.includes(id)) return false;
        if (id === String(item.resourceId)) {
            if (isRequestLineId(item.resourceId)) return false;                 // the request line itself stays
            const rest = ids.filter((x) => x !== id);
            if (!rest.length) { alert('A request needs at least one resource. To drop it, remove the whole request from the sheet.'); return false; }
            item.resourceId = rest[0];                                           // the next one becomes the main resource
            item.resourceIds = rest;
            item.data = {};                                                      // units set on the line belonged to the one removed
        } else {
            item.resourceIds = ids.filter((x) => x !== id);
        }
    });
}

// Planned or built, by hand, in either direction. A planned resource is one that is being scoped but does not exist yet
// (its units still price the request); built means it exists. The record and its units never change.
function applyBuildState(res, buildState) {
    if (!res) return false;
    const planned = buildState === 'planned';
    if (planned) { res.isShell = true; delete res.builtAt; res.plannedAt = new Date().toISOString(); }
    else { delete res.isShell; res.builtAt = new Date().toISOString(); }
    return true;
}

export async function rqSetBuildState(itemId, resourceId, buildState) {
    if (buildState !== 'planned' && buildState !== 'built') return false;
    return changeResources(itemId, (client) => {
        const res = resourceIn(client, resourceId);
        if (!res || Boolean(res.isShell) === (buildState === 'planned')) return false;   // unknown, or already that
        return applyBuildState(res, buildState);
    });
}

export const rqMarkBuilt = (itemId, resourceId) => rqSetBuildState(itemId, resourceId, 'built');

// The same choice from anywhere a resource shows its status: the "Update Status" menu on resource cards and lists.
export async function setResourceBuildState(resourceId, buildState) {
    if (buildState !== 'planned' && buildState !== 'built') return false;
    const data = typeof OL.getCurrentProjectData === 'function' ? OL.getCurrentProjectData() : null;
    const res = (data?.resources || []).find((r) => String(r.id) === String(resourceId)) || resourceIn(getActiveClient(), resourceId);
    if (!res || Boolean(res.isShell) === (buildState === 'planned')) return false;
    const before = res.isShell ? 'planned' : 'built';
    applyBuildState(res, buildState);
    if (typeof OL.logResourceEdit === 'function') OL.logResourceEdit(res.id, 'buildState', before, buildState);
    if (typeof OL.closePopoverDropdown === 'function') OL.closePopoverDropdown();
    if (typeof OL.persist === 'function') await OL.persist();
    // If this resource's window is open, draw it again so its button shows the new state; otherwise redraw the list.
    const box = typeof document !== 'undefined' ? document.getElementById('active-modal-box') : null;
    if (box && String(box.dataset?.activeResId) === String(resourceId) && typeof OL.openResourceModal === 'function') OL.openResourceModal(resourceId);
    else if (typeof OL.renderResourceManager === 'function') OL.renderResourceManager();
    else if (typeof window.handleRoute === 'function') window.handleRoute();
    return true;
}

// ---- the status menu and the status pill get a Planned / Built choice (wrapped once all modules have loaded) ----
function buildStateSectionHtml(res) {
    const planned = !!res?.isShell;
    const btn = (value, label) => `
            <button class="btn tiny soft" style="display:flex; align-items:center; gap:8px; width:100%; text-align:left; justify-content:flex-start; padding:6px 8px; ${(planned ? 'planned' : 'built') === value ? 'border:1px solid var(--accent);' : ''}"
                    onclick="OL.setResourceBuildState('${esc(res.id)}', '${value}')">
                <span style="width:8px; height:8px; border-radius:50%; background:${value === 'planned' ? '#f59e0b' : '#22c55e'}; flex-shrink:0;"></span>
                <span style="flex:1;">${label}</span>
                ${(planned ? 'planned' : 'built') === value ? '<span class="tiny muted">current</span>' : ''}
            </button>`;
    return `
        <div class="tiny bold uppercase muted" style="margin:10px 0 6px; padding:2px 4px; border-top:1px solid var(--line); padding-top:8px;">Planned or built</div>
        <div style="display:grid; gap:4px;">${btn('planned', 'Planned (not built yet)')}${btn('built', 'Built')}</div>`;
}

export function installBuildStateControls() {
    if (typeof OL === 'undefined') return false;
    if (typeof OL.openEditResourceStatusDropdown === 'function' && !OL.openEditResourceStatusDropdown.__buildState) {
        const original = OL.openEditResourceStatusDropdown;
        const wrapped = function (event, resourceId) {
            original.call(this, event, resourceId);
            const pop = document.getElementById('task-popover-dropdown');
            const data = typeof OL.getCurrentProjectData === 'function' ? OL.getCurrentProjectData() : null;
            const res = (data?.resources || []).find((r) => String(r.id) === String(resourceId));
            if (pop && res) pop.innerHTML += buildStateSectionHtml(res);
        };
        wrapped.__buildState = true;
        OL.openEditResourceStatusDropdown = wrapped;
    }
    if (typeof OL.renderResourceStatusPill === 'function' && !OL.renderResourceStatusPill.__buildState) {
        const original = OL.renderResourceStatusPill;
        const wrapped = function (res) {
            const base = original.call(this, res);
            if (!res || !res.isShell) return base;
            return base + `<span class="pill tiny" style="font-size:8px; font-weight:bold; padding:2px 6px; border:1px solid #f59e0b; color:#f59e0b; cursor:pointer; white-space:nowrap;" title="Planned: not built yet. Click to change." onclick="event.stopPropagation(); OL.openEditResourceStatusDropdown(event, '${esc(res.id)}')">PLANNED</span>`;
        };
        wrapped.__buildState = true;
        OL.renderResourceStatusPill = wrapped;
    }
    return true;
}

// Units live on the resource, so this opens the resource itself (after keeping what was typed here).
export async function rqSetUnits(itemId, resourceId) {
    const { client, item } = findItem(itemId);
    if (!client || !item) return;
    if (typeof OL.applyRequestFormToItem === 'function') OL.applyRequestFormToItem(item);
    if (typeof OL.persist === 'function') await OL.persist();
    OL.openResourceModal(resourceId);
}

window.OL = window.OL || {};
Object.assign(window.OL, { renderRequestResourcesHtml, requestResourcesPrintCss: REQUEST_RESOURCES_CSS, requestResourcesSectionHtml, rqAddExistingResource, rqAddShell, rqRemoveResource, rqMarkBuilt, rqSetBuildState, setResourceBuildState, installBuildStateControls, rqSetUnits });

// The resource files register the status menu and pill; wrap them once everything has loaded.
if (typeof setTimeout === 'function' && !window.__OL_NO_TIMERS__) setTimeout(() => installBuildStateControls(), 0);
