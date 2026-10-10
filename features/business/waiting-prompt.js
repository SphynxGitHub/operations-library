//======================= FEATURES / BUSINESS / WAITING-ON-CLIENT PROMPT =======================//
// Shown right after someone flips a Sphynx task to a "waiting" status (OL.updateGlobalTaskStatus in
// features/business/tasks.js):
//
//   Pending Client Action / Feedback / Document -> the client tasks this task is waiting on (the ones tied to the
//                          same request/resource and anything set as a Dependency), a way to add a NEW client task or
//                          link an existing one right there, and a notes box.
//   Pending Client Review                       -> just the notes box.
//   Pending Developer Update / Third Party Support -> just the notes box (the status, in a line).
//
// The note is saved on the task itself as task.waitingNote (+ waitingNoteAt / waitingNoteBy). For the client
// statuses it is sidebar context only: the client follow-up's open-items list (features/business/client-followup.js)
// shows it under the item(s) this task is waiting on — never in the email body, which lists task names only. For
// developer / third-party it is the status line of the follow-up's "Waiting on Sphynx" / "Waiting on Other" item
// (see followUpEmailData in core/client-work-rules.js).
// New client tasks made here are linked to the same request(s)/resource(s) as the waiting task and added to its
// Dependencies ("Waiting on"), so they feed the one consolidated client follow-up like any other client ask.
//
// Developer / third-party tasks also get "Also affects these projects": task.sharedWith (project ids) puts the item on each of
// those projects' follow-ups as well (sharedParkedTasksFor in core/client-work-rules.js).
//
// Skipped for client asks and the follow-up task itself — it is for Sphynx's own work being parked.

import { state, esc, uid, updateAndSync } from '../../core/data.js';
import { linksForTask, addLink } from '../../core/task-links.js';
import { isClientFacing } from '../../core/request-tasks.js';

const KIND_BY_STATUS = {
    'pending client action': 'action',
    'pending client feedback': 'feedback',
    'pending client document': 'document',
    'pending client review': 'review',
    'pending developer update': 'developer',
    'pending third party support': 'third_party',
};
// Tasks made for the client are always "Client Task"; the kind (document, feedback, review) is kept in askKind.
const CLIENT_TASK_STATUS = 'Client Task';
const KIND_LABEL = { action: 'Action', document: 'Document', feedback: 'Feedback', review: 'Review / confirmation' };
// Which kinds get the client-task list and "add a client task" box, and what each window says.
const TASK_KINDS = ['action', 'feedback', 'document'];
const WINDOW = {
    action:      { head: 'Waiting on the client', placeholder: 'What the client needs to do, and anything they should know.', hint: 'Shown under this item in the client follow-up\'s open-items list. It isn\'t put in the email itself.' },
    feedback:    { head: 'Waiting on the client', placeholder: 'Context for the follow-up: what exactly is needed, and why.', hint: 'Shown under this item in the client follow-up\'s open-items list. It isn\'t put in the email itself.' },
    document:    { head: 'Waiting on the client', placeholder: 'Context for the follow-up: what exactly is needed, and why.', hint: 'Shown under this item in the client follow-up\'s open-items list. It isn\'t put in the email itself.' },
    review:      { head: 'Waiting on the client', placeholder: 'What is the client reviewing, and anything they should know?', hint: 'Shown under this item in the client follow-up\'s open-items list. It isn\'t put in the email itself.' },
    developer:   { head: 'Waiting on a developer', placeholder: 'What the developer is working on or has been asked, and what is expected back.', hint: 'Shown as this item\'s status under "Waiting on Sphynx" in the client follow-up. It is included in the email unless you uncheck the item there.' },
    third_party: { head: 'Waiting on a third party', placeholder: 'Who it is with, what they were asked for, and any reference or ticket number.', hint: 'Shown as this item\'s status under "Waiting on Other" in the client follow-up. It is included in the email unless you uncheck the item there.' },
};

const OVERLAY_ID = 'waiting-prompt';

export function waitingKindForStatus(status) {
    return KIND_BY_STATUS[String(status || '').trim().toLowerCase()] || null;
}

function findTask(clientId, taskId) {
    return (state.clients?.[clientId]?.projectData?.clientTasks || []).find((t) => t && String(t.id) === String(taskId)) || null;
}

function dependentTasks(clientId, taskId) {
    return typeof OL.openClientTasksForId === 'function' ? OL.openClientTasksForId(clientId, taskId) : [];
}

// Open client asks in the project that this task is not already waiting on — for "link an existing one".
function linkableAsks(clientId, taskId) {
    const have = new Set(dependentTasks(clientId, taskId).map((t) => String(t.id)));
    const closed = (t) => typeof OL.isClosedStatus === 'function' && OL.isClosedStatus(t.status);
    return (state.clients?.[clientId]?.projectData?.clientTasks || [])
        .filter((t) => t && String(t.id) !== String(taskId) && !have.has(String(t.id)) && !t.consolidatedFollowUp && t.askKind !== 'follow_up'
            && (t.isClientTask || ['review', 'document', 'feedback'].includes(t.askKind)) && !closed(t))
        .sort((a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || '')));
}

// Every project except this one (and the General / Business catch-all), A-Z.
function otherProjects(clientId) {
    return Object.values(state.clients || {})
        .filter((c) => c && String(c.id) !== String(clientId) && c.id !== OL.GENERAL_PROJECT_ID && c.meta?.status !== 'Partner')
        .sort((a, b) => String(a.meta?.name || a.id).localeCompare(String(b.meta?.name || b.id)));
}

OL.waitPromptFilterProjects = function(q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    document.querySelectorAll('#wp-share-list .wp-share-row').forEach((row) => {
        const name = row.getAttribute('data-name') || '';
        row.style.display = words.every((w) => name.includes(w)) ? 'flex' : 'none';
    });
};

// A small pill on a parked task's row to reopen this window (notes, and the projects it is shared with).
OL.renderWaitingDetailsPill = function(t) {
    if (!t || !waitingKindForStatus(t.status) || t.consolidatedFollowUp || t.askKind) return '';
    const n = (t.sharedWith || []).length;
    return `<span class="pill tiny soft" style="cursor:pointer; font-size:10px; display:inline-flex; align-items:center; gap:3px; flex-shrink:0;"
        onclick="event.stopPropagation(); OL.promptClientWaiting('${t.clientId}', '${t.id}', '${esc(t.status)}')" title="Waiting details: note${(waitingKindForStatus(t.status) === 'developer' || waitingKindForStatus(t.status) === 'third_party') ? ' and other projects it affects' : ''}">
        <i data-lucide="${n ? 'share-2' : 'clock'}" style="width:10px;height:10px; pointer-events:none;"></i>${n ? ` +${n}` : ''}</span>`;
};

function listHtml(clientId, taskId) {
    const rows = dependentTasks(clientId, taskId);
    const linkable = linkableAsks(clientId, taskId);
    return `
        <div style="display:grid; gap:4px; margin-bottom:8px;">
            ${rows.length ? rows.map((t) => `
                <div class="tiny" style="display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid var(--line); border-radius:6px;">
                    <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(t.title || t.name || 'Client task')}</span>
                    <span class="pill tiny soft" style="font-size:9px;">${esc(t.status || '')}</span>
                </div>`).join('') : '<div class="tiny muted">No client tasks are tied to this yet.</div>'}
        </div>
        ${linkable.length ? `
        <select class="modal-input tiny" style="width:100%; margin-bottom:8px;" onchange="if (this.value) OL.waitPromptLinkExisting(this.value)">
            <option value="">+ Link a client task that already exists…</option>
            ${linkable.map((t) => `<option value="${esc(String(t.id))}">${esc(t.title || t.name || 'Client task')}</option>`).join('')}
        </select>` : ''}`;
}

function redrawList() {
    const st = OL._waitPromptState;
    const box = document.getElementById('wp-tasks');
    if (st && box) box.innerHTML = listHtml(st.clientId, st.taskId);
}

OL.promptClientWaiting = function(clientId, taskId, status) {
    const kind = waitingKindForStatus(status);
    const task = findTask(clientId, taskId);
    if (!kind || !task) { console.info('[waiting prompt] not shown: no matching status/task', { status, found: !!task }); return; }
    // Client asks and the follow-up itself aren't "Sphynx work waiting on the client". Judged the same way the
    // follow-up rules judge it (assignee + ask kind), NOT by task.isClientTask: that flag is set from the assignee
    // when the task is created and can be stale or wrong for a task assigned to a named team member.
    const sphynxCtx = { sphynxNames: (state.master?.sphynxTeam || []).map((m) => m.name).concat(OL.thirdPartyAssignees || []) };
    if (task.consolidatedFollowUp || task.askKind === 'follow_up' || isClientFacing(task, sphynxCtx)) {
        console.info('[waiting prompt] not shown: this is a client ask / follow-up task, not Sphynx work', { assignee: task.assignee, askKind: task.askKind });
        return;
    }

    document.getElementById(OVERLAY_ID)?.remove();
    OL._waitPromptState = { clientId, taskId, kind };
    const showTasks = TASK_KINDS.includes(kind);
    const win = WINDOW[kind];
    const title = task.title || task.name || 'This task';

    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;
    wrap.style.cssText = 'position:fixed; inset:0; z-index:20000; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.6);';
    wrap.onclick = () => OL.waitPromptClose();
    wrap.innerHTML = `
        <div class="card" style="max-width:520px; width:92vw; max-height:88vh; overflow-y:auto; padding:20px; cursor:default;" onclick="event.stopPropagation();">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-weight:bold;">
                <i data-lucide="clock" style="width:16px;height:16px;color:var(--accent);"></i> ${esc(win.head)}
            </div>
            <div class="small" style="margin-bottom:14px; line-height:1.5;"><strong>${esc(title)}</strong> is now <strong>${esc(status)}</strong>.</div>

            ${showTasks ? `
            <div class="tiny bold uppercase muted" style="margin-bottom:6px;">Client tasks it's waiting on</div>
            <div id="wp-tasks">${listHtml(clientId, taskId)}</div>
            <div style="border:1px solid var(--line); border-radius:6px; padding:10px; margin-bottom:14px;">
                <div class="tiny muted" style="margin-bottom:4px;">Add a new client task</div>
                <input id="wp-new-title" type="text" class="modal-input tiny" placeholder="What do you need from the client?"
                       onkeydown="if(event.key==='Enter'){ event.preventDefault(); OL.waitPromptAddNew(); }">
                <div style="display:flex; gap:6px; margin-top:6px;">
                    <select id="wp-new-kind" class="modal-input tiny" style="flex:1;">
                        ${['action', 'document', 'feedback', 'review'].map((k) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${esc(KIND_LABEL[k])}</option>`).join('')}
                    </select>
                    <button type="button" class="btn tiny soft" onclick="OL.waitPromptAddNew()">+ Add</button>
                </div>
            </div>` : ''}

            ${(kind === 'developer' || kind === 'third_party') ? `
            <div class="tiny bold uppercase muted" style="margin-bottom:4px;">Also affects these projects</div>
            <div class="tiny muted" style="margin-bottom:6px;">Tick every other project this is holding up. It goes on each one's client follow-up too, and comes off all of them when this one is done.</div>
            <input id="wp-share-filter" type="text" class="modal-input tiny" style="width:100%; margin-bottom:6px;" placeholder="Search projects…" oninput="OL.waitPromptFilterProjects(this.value)">
            <div id="wp-share-list" style="max-height:160px; overflow-y:auto; border:1px solid var(--line); border-radius:6px; padding:4px 8px; margin-bottom:14px;">
                ${otherProjects(clientId).map((c) => `
                    <label class="tiny wp-share-row" data-name="${esc(String(c.meta?.name || c.id).toLowerCase())}" style="display:flex; align-items:center; gap:6px; padding:3px 0; cursor:pointer;">
                        <input type="checkbox" class="wp-share-cb" value="${esc(String(c.id))}" ${(task.sharedWith || []).map(String).includes(String(c.id)) ? 'checked' : ''}> ${esc(c.meta?.name || c.id)}
                    </label>`).join('') || '<div class="tiny muted">No other projects.</div>'}
            </div>` : ''}

            <div class="tiny bold uppercase muted" style="margin-bottom:6px;">Notes</div>
            <textarea id="wp-note" class="modal-input" rows="4" style="width:100%; resize:vertical;"
                      placeholder="${esc(win.placeholder)}">${esc(task.waitingNote || '')}</textarea>
            <div class="tiny muted" style="margin-top:4px;">${esc(win.hint)}</div>

            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
                <button class="btn small soft" onclick="OL.waitPromptClose()">Skip</button>
                <button class="btn small primary" style="font-weight:bold;" onclick="OL.waitPromptSave()">Save</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    if (window.lucide) lucide.createIcons();
    (document.getElementById(showTasks ? 'wp-new-title' : 'wp-note'))?.focus();
};

OL.waitPromptClose = function() {
    document.getElementById(OVERLAY_ID)?.remove();
    OL._waitPromptState = null;
};

// Creates a client task tied to the same request(s)/resource(s) as the waiting task, and adds it to that task's
// "Waiting on" list.
OL.waitPromptAddNew = async function() {
    const st = OL._waitPromptState;
    if (!st) return;
    const input = document.getElementById('wp-new-title');
    const title = (input?.value || '').trim();
    if (!title) { alert('Say what you need from the client.'); return; }
    const kind = document.getElementById('wp-new-kind')?.value || (TASK_KINDS.includes(st.kind) ? st.kind : 'action');
    const now = new Date().toISOString();

    await updateAndSync(() => {
        const client = state.clients?.[st.clientId];
        const waiting = findTask(st.clientId, st.taskId);
        if (!client?.projectData || !waiting) return;
        if (!Array.isArray(client.projectData.clientTasks)) client.projectData.clientTasks = [];
        const ask = {
            id: uid(), title, name: title, description: `For: ${waiting.title || waiting.name || 'task'}`,
            status: CLIENT_TASK_STATUS, assignee: 'Client Task', dueDate: '',   // client tasks have no due dates
            isClientTask: true, loggedHours: 0, parentTaskId: null, createdBy: 'waiting-prompt', createdAt: now,
            // Documents, feedback and reviews carry an ask kind; a plain action is just a client task.
            ...(kind === 'action' ? {} : { askKind: kind }),
        };
        const links = linksForTask(waiting);
        links.forEach((l) => addLink(ask, l.requestId, l.resourceIds || []));
        if (links[0]) ask.requestLineItemId = links[0].requestId;
        client.projectData.clientTasks.unshift(ask);
        if (!Array.isArray(waiting.blockedBy)) waiting.blockedBy = [];
        waiting.blockedBy.push({ kind: 'task', id: ask.id, addedDate: now });
    }, st.clientId);

    if (input) input.value = '';
    redrawList();
    input?.focus();
};

OL.waitPromptLinkExisting = async function(askId) {
    const st = OL._waitPromptState;
    if (!st || !askId) return;
    await updateAndSync(() => {
        const waiting = findTask(st.clientId, st.taskId);
        if (!waiting) return;
        if (!Array.isArray(waiting.blockedBy)) waiting.blockedBy = [];
        if (!waiting.blockedBy.some((d) => d.kind === 'task' && String(d.id) === String(askId))) {
            waiting.blockedBy.push({ kind: 'task', id: askId, addedDate: new Date().toISOString() });
        }
    }, st.clientId);
    redrawList();
};

OL.waitPromptSave = async function() {
    const st = OL._waitPromptState;
    if (!st) return;
    // Anything typed in the "new task" box but not added yet is added first, so it isn't lost.
    if ((document.getElementById('wp-new-title')?.value || '').trim()) await OL.waitPromptAddNew();
    const text = (document.getElementById('wp-note')?.value || '').trim();
    const shareBoxes = document.querySelectorAll('#wp-share-list .wp-share-cb');
    const sharedWith = [...shareBoxes].filter((cb) => cb.checked).map((cb) => cb.value);
    await updateAndSync(() => {
        const t = findTask(st.clientId, st.taskId);
        if (!t) return;
        if (shareBoxes.length) {   // only the developer / third-party window has the list
            if (sharedWith.length) t.sharedWith = sharedWith; else delete t.sharedWith;
        }
        if (text) {
            if (t.waitingNote !== text) {
                t.waitingNote = text;
                t.waitingNoteAt = new Date().toISOString();
                t.waitingNoteBy = typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '';
            }
        } else {
            delete t.waitingNote; delete t.waitingNoteAt; delete t.waitingNoteBy;
        }
    }, st.clientId);
    OL.waitPromptClose();
    if (typeof OL.refreshTaskView === 'function') OL.refreshTaskView();
};

Object.assign(window.OL, {
    promptClientWaiting: OL.promptClientWaiting, waitPromptClose: OL.waitPromptClose, waitPromptAddNew: OL.waitPromptAddNew,
    waitPromptLinkExisting: OL.waitPromptLinkExisting, waitPromptSave: OL.waitPromptSave, waitingKindForStatus,
    waitPromptFilterProjects: OL.waitPromptFilterProjects, renderWaitingDetailsPill: OL.renderWaitingDetailsPill,
});
