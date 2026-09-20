//======================= FEATURES / REQUEST TASKS =======================//
// Tasks under each request. On the scoping sheet every request that has tasks gets a slim bar (tasks done,
// start and end dates, what is waiting on the client) that opens into the tasks grouped Before, Implementation
// and After. The same list shows in the request window. A meeting request can be linked to its calendar
// event, so the meeting's action items appear under it as After. The logic is in core/request-tasks.js.

import { state, esc, db, getActiveClient, updateAndSync } from '../core/data.js';
import {
    groupRequestTasks, resourceDates, taskPhase, clientTasksByRequest, renderClientTasksAppendix, CLIENT_TASKS_CSS,
    PHASES, PHASE_LABELS,
} from '../core/request-tasks.js';

const MEETING_TYPES = ['meeting', 'training', 'audit'];

function ctxFor() {
    const names = (state.master?.sphynxTeam || []).map((m) => m.name).concat(typeof OL !== 'undefined' ? (OL.thirdPartyAssignees || []) : []);
    const statuses = typeof OL.getSystemStatuses === 'function' ? OL.getSystemStatuses() : [];
    const closed = statuses.filter((s) => s.isClosed).map((s) => s.name);
    return { closedNames: closed.length ? closed : ['Done'], sphynxNames: names, statuses, resourceNameFor: (item) => (typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId)?.name : '') || '' };
}

const day = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const dayWithYear = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

function refreshScopingIfOpen() {
    if (typeof document !== 'undefined' && document.getElementById('scoping-search-input') && typeof window.renderScopingSheet === 'function') window.renderScopingSheet();
}

// ---------------- the list of tasks ----------------
function taskRowHtml(client, entry, statuses) {
    const t = entry.task;
    const status = statuses.find((s) => s.name === t.status) || { color: '#94a3b8' };
    const title = t.title || t.name || 'Task';
    return `
        <div class="rt-task" style="display:flex; align-items:center; gap:8px; padding:3px 0; cursor:pointer; ${entry.done ? 'opacity:0.55;' : ''}"
             onclick="event.stopPropagation(); OL.openTaskInContext('${esc(client.id)}', '${esc(t.id)}')">
            <span title="${esc(t.status || 'Pending')}" style="width:8px; height:8px; border-radius:50%; flex-shrink:0; background:${status.color};"></span>
            <span style="flex:1; min-width:0; font-size:12px; ${entry.done ? 'text-decoration:line-through;' : ''} overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(title)}</span>
            ${entry.clientFacing ? `<span class="pill tiny" style="font-size:9px; border:1px solid #f59e0b; color:#f59e0b; flex-shrink:0;">Client</span>` : ''}
            <span class="tiny muted" style="flex-shrink:0;">${esc(t.assignee || '')}</span>
            <span class="tiny" style="flex-shrink:0; width:52px; text-align:right; color:var(--muted);">${esc(day(String(t.dueDate || '').slice(0, 10)))}</span>
        </div>`;
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
            ${g.groups[p].map((e) => taskRowHtml(client, e, ctx.statuses)).join('')}
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
            <button type="button" class="btn tiny soft" style="font-size:10px; padding:1px 8px;" onclick="event.stopPropagation(); ${opts.editAction ? esc(opts.editAction) : 'OL.openRequestLineModal'}('${esc(item.id)}')">Edit request</button>
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
});
