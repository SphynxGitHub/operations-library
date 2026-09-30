//======================= FEATURES / REQUEST TASKS =======================//
// Tasks under each request. On the scoping sheet every request that has tasks gets a slim bar (tasks done,
// start and end dates, what is waiting on the client) that opens into the tasks grouped Before, Implementation
// and After. The same list shows in the request window. A meeting request can be linked to its calendar
// event, so the meeting's action items appear under it as After. The logic is in core/request-tasks.js.

import { state, esc, db, getActiveClient, updateAndSync } from '../core/data.js';
import { addLink, removeLink, taskAppliesToRequest, requestIdsForTask } from '../core/task-links.js';
import { DEFAULT_ASK_TEMPLATES } from '../core/activation.js';
import { requestResourceIds as requestResourceIdsOf } from '../core/request-pricing.js';
import {
    groupRequestTasks, resourceDates, taskPhase, clientTasksByRequest, renderClientTasksAppendix, CLIENT_TASKS_CSS,
    PHASES, PHASE_LABELS,
} from '../core/request-tasks.js';

// Which request types can link to a calendar meeting. 'meeting' and 'audit' aren't request types any more —
// audit folded into 'revision' (a revision can still be linked to the meeting where it came up), and a meeting
// itself is no longer created as a request at all; it comes directly from the booked calendar event.
const MEETING_TYPES = ['training', 'revision'];

function ctxFor() {
    const names = (state.master?.sphynxTeam || []).map((m) => m.name).concat(typeof OL !== 'undefined' ? (OL.thirdPartyAssignees || []) : []);
    const statuses = typeof OL.getSystemStatuses === 'function' ? OL.getSystemStatuses() : [];
    const closed = statuses.filter((s) => s.isClosed).map((s) => s.name);
    const resourcesFor = (item) => requestResourceIdsOf(item).map((id) => (typeof OL.getResourceById === 'function' ? OL.getResourceById(id) : null)).filter((r) => r && !String(r.id).startsWith('reqline-'));
    return {
        closedNames: closed.length ? closed : ['Done'], sphynxNames: names, statuses,
        resourceNameFor: (item) => (typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId)?.name : '') || '',
        // the SOP's client-ask templates, so the printed sheet can preview what will be asked (see clientTasksByRequest)
        askTemplates: (state.master?.askTemplates && state.master.askTemplates.length) ? state.master.askTemplates : DEFAULT_ASK_TEMPLATES,
        resourcesFor, resourceTypeFor: (item) => resourcesFor(item)[0]?.type || '',
    };
}

const day = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const dayWithYear = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

function refreshScopingIfOpen() {
    if (typeof document !== 'undefined' && document.getElementById('scoping-search-input') && typeof window.renderScopingSheet === 'function') window.renderScopingSheet();
}

// ---------------- the list of tasks ----------------
function taskRowHtml(client, entry, statuses, indent = 0) {
    const t = entry.task;
    const status = statuses.find((s) => s.name === t.status) || { color: '#94a3b8' };
    const title = t.title || t.name || 'Task';
    return `
        <div class="rt-task" style="display:flex; align-items:center; gap:8px; padding:3px 0; margin-left:${indent}px; cursor:pointer; ${entry.done ? 'opacity:0.55;' : ''}"
             onclick="event.stopPropagation(); OL.openTaskInContext('${esc(client.id)}', '${esc(t.id)}')">
            ${indent ? `<i data-lucide="corner-down-right" style="width:11px;height:11px;color:#f59e0b;flex-shrink:0;"></i>` : `<span title="${esc(t.status || 'Pending')}" style="width:8px; height:8px; border-radius:50%; flex-shrink:0; background:${status.color};"></span>`}
            <span style="flex:1; min-width:0; font-size:12px; ${entry.done ? 'text-decoration:line-through;' : ''} overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(title)}</span>
            ${entry.clientFacing ? `<span class="pill tiny" style="font-size:9px; border:1px solid #f59e0b; color:#f59e0b; flex-shrink:0;">Client</span>` : ''}
            <span class="tiny muted" style="flex-shrink:0;">${esc(t.assignee || '')}</span>
            <span class="tiny" style="flex-shrink:0; width:52px; text-align:right; color:var(--muted);">${esc(day(String(t.dueDate || '').slice(0, 10)))}</span>
        </div>`;
}

// Within the During (implementation) phase, a client-ask entry linked to the same request nests under whichever
// implementation-task entry it's an explicit Dependency of, or — when there's only one implementation task in
// this phase — under that one by default, since almost every request has exactly one per resource. Anything that
// doesn't resolve to a parent this way (several implementation tasks, no Dependency set) stays a top-level row,
// same as before, rather than guessing wrong.
function nestImplementationEntries(entries) {
    const parents = entries.filter((e) => !e.clientFacing);
    const children = entries.filter((e) => e.clientFacing);
    const claimed = new Set();
    const childrenFor = (parent) => children.filter((c) => {
        if (claimed.has(c.task.id)) return false;
        const byDependency = (parent.task.blockedBy || []).some((d) => d && d.kind === 'task' && String(d.id) === String(c.task.id));
        const onlyParent = parents.length === 1;
        return byDependency || onlyParent;
    });
    const rows = [];
    parents.forEach((p) => {
        rows.push({ entry: p, indent: 0 });
        childrenFor(p).forEach((c) => { claimed.add(c.task.id); rows.push({ entry: c, indent: 20 }); });
    });
    children.filter((c) => !claimed.has(c.task.id)).forEach((c) => rows.push({ entry: c, indent: 0 }));
    return rows;
}

export function requestTasksPanelHtml(client, item) {
    const ctx = ctxFor();
    const g = groupRequestTasks(client, item, ctx);
    const type = String(item.requestType || 'build');
    const canLink = MEETING_TYPES.includes(type);
    if (!g.total && !canLink) return '';
    const summary = [
        `${g.done}/${g.total} done`,
        g.dates.start ? `Starts ${dayWithYear(g.dates.start)}` : '',
        g.dates.end ? `Ends ${dayWithYear(g.dates.end)}` : '',
        g.clientOpen.length ? `${g.clientOpen.length} waiting on the client` : '',
    ].filter(Boolean).join(' · ');
    const groupHtml = PHASES.map((p) => g.groups[p].length ? `
        <div style="margin-top:8px;">
            <div class="tiny bold uppercase muted" style="letter-spacing:0.05em; margin-bottom:2px;">${PHASE_LABELS[p]} <span class="pill tiny soft" style="font-size:9px;">${g.groups[p].length}</span></div>
            ${(p === 'implementation' ? nestImplementationEntries(g.groups[p]) : g.groups[p].map((e) => ({ entry: e, indent: 0 })))
                .map(({ entry, indent }) => taskRowHtml(client, entry, ctx.statuses, indent)).join('')}
        </div>` : '').join('');
    return `
        <div class="request-tasks-panel" style="margin:0 0 8px 24px; padding:10px 12px; border-left:2px solid rgba(100,198,162,0.5); background:rgba(255,255,255,0.02); border-radius:0 6px 6px 0;" onclick="event.stopPropagation();">
            <div class="tiny muted">${esc(summary || 'No tasks yet')}</div>
            ${canLink ? meetingLinkHtml(client, item) : ''}
            ${groupHtml || (g.total ? '' : '<div class="tiny muted" style="margin-top:6px;">No tasks yet.</div>')}
        </div>`;
}

function meetingLinkHtml(client, item) {
    const events = (OL._clientEvents || {})[client.id];
    if (events === undefined) { loadClientEvents(client.id).then(() => refreshScopingIfOpen()); }
    const options = (events || []).map((e) => `<option value="${esc(e.id)}" ${String(item.linkedEventId || '') === String(e.id) ? 'selected' : ''}>${esc((e.title || 'Meeting').slice(0, 60))}${e.start ? ' (' + esc(String(e.start).slice(0, 10)) + ')' : ''}</option>`).join('');
    return `
        <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
            <span class="tiny muted" style="flex-shrink:0;">Linked meeting</span>
            <select class="modal-input tiny" style="flex:1; min-width:0; max-width:340px;" onchange="OL.linkRequestMeeting('${esc(item.id)}', this.value)">
                <option value="">${events === undefined ? 'Loading meetings...' : 'None: its action items are not shown here'}</option>${options}
            </select>
        </div>`;
}

// The slim bar under a request on the scoping sheet, and the panel when it is open. Every request gets one, with
// an Edit request button (the request window is where its resources and their fees are), how many resources it
// covers when it covers more than one, and, when it has tasks, a toggle that opens them.
export function requestTasksRowHtml(client, item, opts = {}) {
    if (!client || !item) return '';
    const ctx = ctxFor();
    const g = groupRequestTasks(client, item, ctx);
    const canLink = MEETING_TYPES.includes(String(item.requestType || 'build'));
    const showTasks = g.total > 0 || canLink;
    const open = showTasks && !!(OL._requestTasksOpen || {})[item.id];
    const bits = [
        g.total ? `Tasks ${g.done}/${g.total}` : 'Tasks',
        g.dates.start && g.dates.end ? (g.dates.start === g.dates.end ? day(g.dates.start) : `${day(g.dates.start)} → ${day(g.dates.end)}`) : '',
        g.clientOpen.length ? `${g.clientOpen.length} for the client` : '',
    ].filter(Boolean).join(' · ');
    const color = g.clientOpen.length ? '#f59e0b' : 'var(--muted)';

    let covers = '';
    if (typeof OL.getRequestPriceBreakdown === 'function') {
        const lines = OL.getRequestPriceBreakdown(item).lines.filter((l) => !String(l.resourceId).startsWith('reqline-'));
        if (lines.length > 1) covers = `<span class="pill tiny soft" style="font-size:10px;" title="${esc(lines.map((l) => l.name).join(', '))}">${lines.length} resources</span>`;
    }
    return `
        <div class="request-tasks-bar" style="display:flex; align-items:center; gap:10px; padding:2px 12px 2px 24px; font-size:11px;">
            ${showTasks
                ? `<span style="color:${color}; cursor:pointer;" onclick="OL.toggleRequestTasks('${esc(item.id)}')">${open ? '▾' : '▸'} ${esc(bits)}</span>`
                : ''}
            <span style="flex:1;"></span>
            ${covers}
        </div>
        ${open ? requestTasksPanelHtml(client, item) : ''}`;
}

export function toggleRequestTasks(itemId) {
    OL._requestTasksOpen = OL._requestTasksOpen || {};
    OL._requestTasksOpen[itemId] = !OL._requestTasksOpen[itemId];
    refreshScopingIfOpen();
}

// ---------------- linking a meeting ----------------
export async function loadClientEvents(clientId) {
    OL._clientEvents = OL._clientEvents || {};
    if (OL._clientEvents[clientId] !== undefined && !OL._clientEventsLoading?.[clientId]) return OL._clientEvents[clientId];
    OL._clientEventsLoading = { ...(OL._clientEventsLoading || {}), [clientId]: true };
    try {
        const { data, error } = await db.from('calendar_events').select('id, title, start').eq('linked_client_id', clientId).order('start', { ascending: false }).limit(100);
        OL._clientEvents[clientId] = error ? [] : (data || []);
    } catch (e) {
        OL._clientEvents[clientId] = [];
    } finally {
        OL._clientEventsLoading = { ...(OL._clientEventsLoading || {}), [clientId]: false };
    }
    return OL._clientEvents[clientId];
}

export async function linkRequestMeeting(itemId, eventId) {
    const client = getActiveClient();
    const item = (client?.projectData?.scopingSheets || []).flatMap((s) => s?.lineItems || []).find((i) => i && String(i.id) === String(itemId));
    if (!item) return;
    await updateAndSync(() => { if (eventId) item.linkedEventId = eventId; else delete item.linkedEventId; }, client.id);
    refreshScopingIfOpen();
}


// ---------------- linking existing tasks to a request ----------------
// Any task on the project — Sphynx's own or the client's — can be linked to a request, including a Pending one that
// is not in a round yet. Tasks already linked show ticked; ticking or unticking links or unlinks it right away.
// A task can be linked to several requests. Follow-up tasks, status notes and meeting-summary tasks are housekeeping
// the app makes itself, so they are not offered.
const requestItemById = (client, id) => (client?.projectData?.scopingSheets || []).flatMap((s) => s?.lineItems || []).find((i) => i && String(i.id) === String(id));
const requestName = (client, item) => (item?.name && String(item.name).trim()) || (typeof OL.getResourceById === 'function' ? OL.getResourceById(item?.resourceId)?.name : '') || 'Request';

function linkableTasks(client, item, q, showDone) {
    const ctx = ctxFor();
    const closed = new Set(ctx.closedNames);
    const needle = String(q || '').trim().toLowerCase();
    return (client?.projectData?.clientTasks || [])
        .filter((t) => t && !t.consolidatedFollowUp && !t.statusNoteFor && !t.meetingSummaryEventId)
        .filter((t) => showDone || !closed.has(t.status) || taskAppliesToRequest(t, item.id))
        .filter((t) => !needle || `${t.title || t.name || ''} ${t.assignee || ''}`.toLowerCase().includes(needle))
        .map((t) => ({ t, linked: taskAppliesToRequest(t, item.id), client: isClientFacing(t, ctx) }))
        .sort((a, b) => (b.linked - a.linked) || (b.client - a.client) || String(a.t.title || a.t.name || '').localeCompare(String(b.t.title || b.t.name || '')));
}

function linkPickerHtml(client, item) {
    const st = OL._linkTasksState || {};
    const rows = linkableTasks(client, item, st.q, st.showDone);
    const pending = String(item.status || '') === 'Backlog';
    const linkedClient = rows.some((r) => r.linked && r.client);
    return `
        <div class="modal-head"><div class="modal-title-text">🔗 Link tasks to: ${esc(requestName(client, item))}</div><div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeLinkTasksModal()">Done</button></div>
        <div class="modal-body" style="max-width:640px;">
            <div class="tiny muted" style="margin-bottom:8px;">Tick a task to link it to this request; untick to unlink. This includes the client's tasks.${pending ? ' This request is Pending (not in a round yet).' : ''}</div>
            ${pending && linkedClient ? `<div class="tiny" style="margin-bottom:8px; padding:6px 8px; border:1px solid #f59e0b; color:#f59e0b; border-radius:6px;">A client task linked only to a Pending request is left out of client follow-up emails until the request is added to a round.</div>` : ''}
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <input id="lt-search" type="text" class="modal-input tiny" style="flex:1;" placeholder="Search tasks…" value="${esc(st.q || '')}" oninput="OL.linkTasksSearch(this.value)">
                <label class="tiny" style="display:flex; align-items:center; gap:4px; cursor:pointer; white-space:nowrap;"><input type="checkbox" ${st.showDone ? 'checked' : ''} onchange="OL.linkTasksShowDone(this.checked)"> Show completed</label>
            </div>
            <div style="max-height:380px; overflow:auto; display:grid; gap:2px;">
                ${rows.map(({ t, linked, client: isC }) => {
                    const others = requestIdsForTask(t).filter((id) => String(id) !== String(item.id)).map((id) => requestName(client, requestItemById(client, id)));
                    return `<label style="display:flex; align-items:flex-start; gap:8px; padding:5px 6px; border-radius:4px; cursor:pointer; font-size:12px;">
                        <input type="checkbox" style="margin-top:2px;" ${linked ? 'checked' : ''} onchange="OL.toggleRequestTaskLink('${esc(String(item.id))}', '${esc(String(t.id))}', this.checked)">
                        <span style="flex:1; min-width:0;">${esc(t.title || t.name || 'Task')}
                            ${isC ? '<span class="pill tiny" style="font-size:9px; border:1px solid #f59e0b; color:#f59e0b;">Client</span>' : ''}
                            <span class="muted" style="display:block; font-size:11px;">${esc(t.assignee || 'Unassigned')} · ${esc(t.status || 'Pending')}${others.length ? ` · also on: ${esc(others.join(', '))}` : ''}</span>
                        </span></label>`;
                }).join('') || '<div class="tiny muted">No tasks match.</div>'}
            </div>
        </div>`;
}

export function openLinkTasksModal(itemId) {
    const client = getActiveClient();
    const item = requestItemById(client, itemId);
    if (!client || !item) return;
    OL._linkTasksState = { itemId: String(itemId), q: '', showDone: false };
    OL.showOverlayModal(linkPickerHtml(client, item));
    if (window.lucide) lucide.createIcons();
}
function repaintLinkPicker() {
    const st = OL._linkTasksState; if (!st) return;
    const client = getActiveClient(); const item = requestItemById(client, st.itemId); if (!item) return;
    const run = () => OL.showOverlayModal(linkPickerHtml(client, item));
    if (typeof OL.reRenderPreservingFocus === 'function') OL.reRenderPreservingFocus(run); else run();
}
export function linkTasksSearch(q) { if (OL._linkTasksState) { OL._linkTasksState.q = q; repaintLinkPicker(); } }
export function linkTasksShowDone(on) { if (OL._linkTasksState) { OL._linkTasksState.showDone = !!on; repaintLinkPicker(); } }
export async function toggleRequestTaskLink(itemId, taskId, on) {
    const client = getActiveClient();
    const task = (client?.projectData?.clientTasks || []).find((t) => t && String(t.id) === String(taskId));
    if (!client || !task) return;
    await updateAndSync(() => { if (on) addLink(task, itemId, []); else removeLink(task, itemId); }, client.id);
    repaintLinkPicker();
}
export function closeLinkTasksModal() {
    OL._linkTasksState = null;
    OL.closeModal();
    refreshScopingIfOpen();
}

// ---------------- a task's phase ----------------
export async function setTaskPhase(clientId, taskId, phase) {
    const client = state.clients?.[clientId];
    const task = (client?.projectData?.clientTasks || []).find((t) => t.id === taskId);
    if (!task) return;
    await updateAndSync(() => { if (PHASES.includes(phase)) task.phase = phase; else delete task.phase; }, clientId);
    refreshScopingIfOpen();
}

// The "Phase" choice in the task window, for a task that belongs to a request.
export function taskPhaseSelectHtml(client, task) {
    if (!client || !task || task.requestLineItemId === undefined || task.requestLineItemId === null || task.requestLineItemId === '') return '';
    const item = (client.projectData?.scopingSheets || []).flatMap((s) => s?.lineItems || []).find((i) => i && String(i.id) === String(task.requestLineItemId));
    const auto = PHASE_LABELS[taskPhase({ ...task, phase: undefined }, item)];
    return `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <span class="tiny muted">Phase</span>
            <select class="modal-input tiny" style="width:auto;" onchange="OL.setTaskPhase('${esc(client.id)}', '${esc(task.id)}', this.value)">
                <option value="">Automatic (${esc(auto)})</option>
                ${PHASES.map((p) => `<option value="${p}" ${task.phase === p ? 'selected' : ''}>${PHASE_LABELS[p]}</option>`).join('')}
            </select>
        </div>`;
}

// ---------------- dates and the printed page ----------------
export function getResourceDates(clientId, resourceId) {
    return resourceDates(state.clients?.[clientId], resourceId, ctxFor());
}

// For the printed scoping sheet: the styles and the last page (both empty when the client has nothing to do).
export function clientTasksPrintPage(client) {
    const list = clientTasksByRequest(client, ctxFor());
    if (!list.length) return { css: '', html: '' };
    return { css: CLIENT_TASKS_CSS, html: renderClientTasksAppendix(list, { esc, clientName: client?.meta?.name || '' }) };
}

window.OL = window.OL || {};
Object.assign(window.OL, {
    requestTasksPanelHtml, requestTasksRowHtml, toggleRequestTasks, linkRequestMeeting, loadClientEvents,
    setTaskPhase, taskPhaseSelectHtml, getResourceDates, clientTasksPrintPage,
    openLinkTasksModal, linkTasksSearch, linkTasksShowDone, toggleRequestTaskLink, closeLinkTasksModal,
});
