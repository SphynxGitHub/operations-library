//======================= FEATURES / DEPENDENCIES =======================//
// One "Dependencies" section shared by tasks, requests and resources.
// Stored on the item itself as  item.blockedBy = [{ kind, id, addedDate }]
// where kind is 'task' | 'request' | 'resource' (all within one project).
// "Blocking" (the reverse direction) is worked out on the fly, so there's
// only ever one copy of each link to keep in sync.
// An item is Blocked while anything it's blocked by isn't finished yet.
// (Resources keep their older, separate "dependencies" list untouched.)

import { state, esc, updateAndSync } from '../core/data.js';

const KIND_ICON = { task: 'check-square', request: 'git-pull-request', resource: 'database' };
const KIND_LABEL = { task: 'Task', request: 'Request', resource: 'Resource' };

function project(clientId) { return state.clients?.[clientId]?.projectData || null; }

function findItem(clientId, kind, id) {
    const pd = project(clientId);
    if (!pd || id === undefined || id === null) return null;
    if (kind === 'task') return (pd.clientTasks || []).find((t) => String(t.id) === String(id)) || null;
    if (kind === 'resource') return (pd.localResources || []).find((r) => String(r.id) === String(id)) || null;
    if (kind === 'request') return OL.findRequestItem ? OL.findRequestItem(state.clients[clientId], id) : null;
    return null;
}

function titleOf(clientId, kind, item) {
    if (!item) return 'Deleted item';
    if (kind === 'request') return OL.requestItemTitle ? OL.requestItemTitle(state.clients[clientId], item) : (item.name || 'Request');
    return item.title || item.name || KIND_LABEL[kind];
}

function isDone(kind, item) {
    if (!item) return true; // a deleted dependency shouldn't block forever
    if (kind === 'task') {
        const closed = (OL.getSystemStatuses ? OL.getSystemStatuses() : []).filter((s) => s.isClosed).map((s) => s.name);
        return closed.includes(item.status) || item.status === 'Done' || item.status === 'Completed';
    }
    if (kind === 'request') return ['Done', "Don't Do"].includes(item.status);
    if (kind === 'resource') return /done|complete|live|built|launched/i.test(String(item.status || item.buildStatus || ''));
    return false;
}

function statusText(kind, item) {
    if (!item) return 'Missing';
    return item.status || (kind === 'resource' ? (item.type || 'Resource') : 'Open');
}

// Everything in the project that lists (kind,id) in its blockedBy.
function blockingList(clientId, kind, id) {
    const pd = project(clientId);
    if (!pd) return [];
    const out = [];
    const check = (k, it) => (it?.blockedBy || []).some((d) => d.kind === kind && String(d.id) === String(id)) && out.push({ kind: k, id: it.id, item: it });
    (pd.clientTasks || []).forEach((t) => check('task', t));
    (pd.localResources || []).forEach((r) => check('resource', r));
    (OL.listProjectRequests ? OL.listProjectRequests(state.clients[clientId]) : []).forEach((q) => check('request', q));
    return out;
}

export function isBlocked(clientId, item) {
    return (item?.blockedBy || []).some((d) => !isDone(d.kind, findItem(clientId, d.kind, d.id)));
}

// Would making A blocked by B create a loop (B already waits on A somewhere)?
function createsCycle(clientId, aKind, aId, bKind, bId) {
    const seen = new Set();
    const stack = [[bKind, bId]];
    while (stack.length) {
        const [k, i] = stack.pop();
        if (k === aKind && String(i) === String(aId)) return true;
        const key = k + ':' + i;
        if (seen.has(key)) continue;
        seen.add(key);
        (findItem(clientId, k, i)?.blockedBy || []).forEach((d) => stack.push([d.kind, d.id]));
    }
    return false;
}

OL._depSearch = {};

export function renderDependencySection(clientId, kind, id) {
    const item = findItem(clientId, kind, id);
    if (!item) return '';
    const key = `${kind}-${id}`;
    const blockedBy = (item.blockedBy || []).map((d) => ({ ...d, item: findItem(clientId, d.kind, d.id) }));
    const blocking = blockingList(clientId, kind, id);
    const blocked = isBlocked(clientId, item);

    const row = (d, removable) => `
        <div style="display:flex; align-items:center; gap:8px; padding:5px 6px; border-radius:4px; background:rgba(255,255,255,0.02);">
            <i data-lucide="${KIND_ICON[d.kind]}" style="width:12px;height:12px; flex-shrink:0; color:${d.kind === 'request' ? '#64c6a2' : 'var(--accent)'};"></i>
            <span class="tiny" style="flex:1; min-width:0; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; ${isDone(d.kind, d.item) ? 'text-decoration:line-through; opacity:0.6;' : ''}"
                  onclick="OL.openDependencyTarget('${esc(clientId)}', '${d.kind}', '${esc(String(d.id))}')">${esc(titleOf(clientId, d.kind, d.item))}</span>
            <span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">${esc(KIND_LABEL[d.kind])} · ${esc(statusText(d.kind, d.item))}</span>
            ${removable ? `<button class="btn tiny soft" style="padding:1px 5px; flex-shrink:0;" title="Remove" onclick="OL.removeBlockedBy('${esc(clientId)}', '${kind}', '${esc(String(id))}', '${d.kind}', '${esc(String(d.id))}')">✕</button>` : ''}
        </div>`;

    const q = (OL._depSearch[key] || '').trim().toLowerCase();
    let results = [];
    if (q) {
        const pd = project(clientId) || {};
        const pool = [
            ...(pd.clientTasks || []).map((t) => ({ kind: 'task', id: t.id, item: t })),
            ...(OL.listProjectRequests ? OL.listProjectRequests(state.clients[clientId]) : []).map((r) => ({ kind: 'request', id: r.id, item: r })),
            ...(pd.localResources || []).filter((r) => !r.systemPinned && !r.adminPinned).map((r) => ({ kind: 'resource', id: r.id, item: r }))
        ];
        results = pool
            .filter((p) => !(p.kind === kind && String(p.id) === String(id)))
            .filter((p) => !(item.blockedBy || []).some((d) => d.kind === p.kind && String(d.id) === String(p.id)))
            .filter((p) => titleOf(clientId, p.kind, p.item).toLowerCase().includes(q))
            .slice(0, 12);
    }

    return `
    <div id="deps-${esc(key)}" style="margin-bottom:20px; background:rgba(255,255,255,0.02); padding:14px; border-radius:6px; border:1px solid ${blocked ? '#f59e0b' : 'var(--line)'};">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <i data-lucide="git-merge" style="width:12px;height:12px;"></i>
            <label class="bold tiny uppercase muted" style="margin:0;">Dependencies</label>
            ${blocked ? `<span class="pill tiny" style="font-size:9px; color:#f59e0b; border:1px solid #f59e0b;"><i data-lucide="lock" style="width:9px;height:9px;"></i> Blocked</span>` : ''}
        </div>
        <div class="tiny muted" style="margin-bottom:4px;">Waiting on</div>
        <div style="display:grid; gap:3px; margin-bottom:8px;">${blockedBy.length ? blockedBy.map((d) => row(d, true)).join('') : '<span class="tiny muted">Nothing — ready to work.</span>'}</div>
        <input type="text" class="modal-input tiny" placeholder="+ Add something this waits on (task, request, resource)…" value="${esc(OL._depSearch[key] || '')}"
               style="width:100%;" oninput="OL.setDependencySearch('${esc(clientId)}', '${kind}', '${esc(String(id))}', this.value)">
        ${q ? `<div style="display:grid; gap:3px; margin-top:4px; max-height:160px; overflow:auto;">
            ${results.length ? results.map((p) => `
                <div class="tiny" style="padding:5px 8px; border:1px solid var(--line); border-radius:4px; cursor:pointer; display:flex; gap:6px; align-items:center;"
                     onmousedown="OL.addBlockedBy('${esc(clientId)}', '${kind}', '${esc(String(id))}', '${p.kind}', '${esc(String(p.id))}')">
                    <i data-lucide="${KIND_ICON[p.kind]}" style="width:11px;height:11px;"></i>
                    <span style="flex:1;">${esc(titleOf(clientId, p.kind, p.item))}</span>
                    <span class="muted" style="font-size:9px;">${KIND_LABEL[p.kind]}</span>
                </div>`).join('') : '<span class="tiny muted">No matches in this project.</span>'}
        </div>` : ''}
        ${blocking.length ? `
            <div class="tiny muted" style="margin:10px 0 4px;">Blocking</div>
            <div style="display:grid; gap:3px;">${blocking.map((d) => row(d, false)).join('')}</div>` : ''}
    </div>`;
}

function refresh(clientId, kind, id) {
    const el = document.getElementById(`deps-${kind}-${id}`);
    if (!el) return;
    el.outerHTML = renderDependencySection(clientId, kind, id);
    if (window.lucide) lucide.createIcons();
}

OL.setDependencySearch = function (clientId, kind, id, value) {
    OL._depSearch[`${kind}-${id}`] = value;
    OL.reRenderPreservingFocus ? OL.reRenderPreservingFocus(() => refresh(clientId, kind, id)) : refresh(clientId, kind, id);
};

OL.addBlockedBy = function (clientId, kind, id, depKind, depId) {
    if (createsCycle(clientId, kind, id, depKind, depId)) {
        alert('That would create a loop — the item you picked is already waiting on this one.');
        return;
    }
    updateAndSync(() => {
        const item = findItem(clientId, kind, id);
        if (!item) return;
        if (!item.blockedBy) item.blockedBy = [];
        if (!item.blockedBy.some((d) => d.kind === depKind && String(d.id) === String(depId))) {
            item.blockedBy.push({ kind: depKind, id: depId, addedDate: new Date().toISOString() });
        }
    }, clientId);
    OL._depSearch[`${kind}-${id}`] = '';
    refresh(clientId, kind, id);
};

OL.removeBlockedBy = function (clientId, kind, id, depKind, depId) {
    updateAndSync(() => {
        const item = findItem(clientId, kind, id);
        if (item?.blockedBy) item.blockedBy = item.blockedBy.filter((d) => !(d.kind === depKind && String(d.id) === String(depId)));
    }, clientId);
    refresh(clientId, kind, id);
};

OL.openDependencyTarget = function (clientId, kind, id) {
    if (kind === 'task') return OL.openTaskInContext(clientId, id);
    if (kind === 'request') return OL.openRequestFromTask(clientId, id);
    if (kind === 'resource') { OL.closeModal?.(); return OL.openResourceModal?.(id); }
};

Object.assign(window.OL, { renderDependencySection, isBlocked });
