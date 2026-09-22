// ================= ✅ BULK EMAIL SELECTION =================
// Same idea as the task bulk bar: tick emails (Communications feed or the
// Daily Dashboard), and a bar appears at the bottom to Archive, Move to
// inbox, Delete, or Link them to a project / task / request in one go.
// Archive/delete act on each email's whole conversation, same as the
// single-email buttons, and are mirrored to Gmail.

import { db, state, esc } from '../../core/data.js';

OL.bulkEmailSelection = OL.bulkEmailSelection || {};   // id -> { threadId, clientId }
const SUPA = 'https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1';

OL.renderEmailSelectCheckbox = function(m) {
    const on = !!OL.bulkEmailSelection[m.id];
    return `<input type="checkbox" class="bulk-email-cb" data-email-id="${esc(m.id)}" ${on ? 'checked' : ''} title="Select"
                   style="width:14px; height:14px; cursor:pointer; flex-shrink:0; margin:0;"
                   onclick="event.stopPropagation(); OL.toggleEmailSelection('${esc(m.id)}', '${esc(m.thread_id || '')}', '${esc(m.linked_client_id || '')}', this.checked)">`;
};

// "Select all" for a list of emails (a group header or the whole feed).
OL.renderEmailGroupSelectCheckbox = function(rows) {
    const ids = rows.map(r => r.id);
    const all = ids.length && ids.every(id => OL.bulkEmailSelection[id]);
    OL._emailGroupRows = OL._emailGroupRows || {};
    const key = 'g' + Math.abs(ids.join('|').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
    OL._emailGroupRows[key] = rows.map(r => ({ id: r.id, threadId: r.thread_id || '', clientId: r.linked_client_id || '' }));
    return `<input type="checkbox" ${all ? 'checked' : ''} title="Select all in this list" style="width:14px;height:14px;cursor:pointer;margin:0;"
                   onclick="event.stopPropagation(); OL.toggleEmailGroupSelection('${key}', this.checked)">`;
};

OL.toggleEmailSelection = function(id, threadId, clientId, on) {
    if (on) OL.bulkEmailSelection[id] = { threadId, clientId };
    else delete OL.bulkEmailSelection[id];
    OL.renderBulkEmailToolbar();
};

OL.toggleEmailGroupSelection = function(key, on) {
    (OL._emailGroupRows?.[key] || []).forEach(r => {
        if (on) OL.bulkEmailSelection[r.id] = { threadId: r.threadId, clientId: r.clientId };
        else delete OL.bulkEmailSelection[r.id];
    });
    document.querySelectorAll('.bulk-email-cb').forEach(cb => { cb.checked = !!OL.bulkEmailSelection[cb.dataset.emailId]; });
    OL.renderBulkEmailToolbar();
};

OL.clearEmailSelection = function() {
    OL.bulkEmailSelection = {};
    document.querySelectorAll('.bulk-email-cb').forEach(cb => { cb.checked = false; });
    OL.renderBulkEmailToolbar();
};

// Floating bar, drawn into its own node on <body> so page redraws don't
// wipe it and toggling a box doesn't redraw the page.
OL.renderBulkEmailToolbar = function() {
    let bar = document.getElementById('bulk-email-toolbar');
    const ids = Object.keys(OL.bulkEmailSelection);
    if (!ids.length) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'bulk-email-toolbar'; document.body.appendChild(bar); }
    const clients = Object.values(state.clients || {}).filter(c => c?.meta?.name).sort((a, b) => a.meta.name.localeCompare(b.meta.name));
    const st = OL._bulkEmailLink || (OL._bulkEmailLink = { clientId: '', taskId: '', requestId: '' });
    const chosen = st.clientId ? state.clients[st.clientId] : null;
    const tasks = chosen ? (chosen.projectData?.clientTasks || []).filter(t => t.status !== 'Done') : [];
    const reqs = chosen && OL.listProjectRequests ? OL.listProjectRequests(chosen).filter(r => !['Done', "Don't Do"].includes(r.status)) : [];
    bar.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:520; padding:10px 16px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:center; border:1px solid #a855f7; background:var(--panel-dark, #111); box-shadow:0 8px 24px rgba(0,0,0,0.4); border-radius:10px; max-width:94vw;';
    bar.innerHTML = `
        <strong class="tiny" style="white-space:nowrap;">✉️ ${ids.length} email${ids.length === 1 ? '' : 's'} selected</strong>
        <button class="btn tiny soft" onclick="OL.bulkEmailAction('archive')"><i data-lucide="archive" style="width:11px;height:11px;"></i> Archive</button>
        <button class="btn tiny soft" onclick="OL.bulkEmailAction('unarchive')"><i data-lucide="inbox" style="width:11px;height:11px;"></i> To inbox</button>
        <button class="btn tiny soft" style="color:#ef4444;" onclick="OL.bulkEmailAction('delete')"><i data-lucide="trash-2" style="width:11px;height:11px;"></i> Delete</button>
        <span style="width:1px; height:20px; background:var(--line);"></span>
        <select class="modal-input tiny" style="width:auto; max-width:170px;" onchange="OL._bulkEmailLink.clientId=this.value; OL._bulkEmailLink.taskId=''; OL._bulkEmailLink.requestId=''; OL.renderBulkEmailToolbar();">
            <option value="">Link to project…</option>
            ${clients.map(c => `<option value="${esc(c.id)}" ${st.clientId === c.id ? 'selected' : ''}>${esc(c.meta.name)}</option>`).join('')}
        </select>
        ${chosen ? `
            <select class="modal-input tiny" style="width:auto; max-width:190px;" onchange="OL._bulkEmailLink.requestId=this.value;">
                <option value="">(no request)</option>
                ${reqs.map(r => `<option value="${esc(String(r.id))}" ${String(st.requestId) === String(r.id) ? 'selected' : ''}>${esc(OL.requestItemTitle ? OL.requestItemTitle(chosen, r) : (r.name || 'Request'))}</option>`).join('')}
            </select>
            <select class="modal-input tiny" style="width:auto; max-width:190px;" onchange="OL._bulkEmailLink.taskId=this.value;">
                <option value="">(no task)</option>
                ${tasks.map(t => `<option value="${esc(String(t.id))}" ${String(st.taskId) === String(t.id) ? 'selected' : ''}>${esc(t.title || t.name)}</option>`).join('')}
            </select>
            <button class="btn tiny primary" onclick="OL.bulkEmailLink()">Link</button>
        ` : ''}
        <button class="btn tiny soft" onclick="OL.bulkEmailUnlink()" title="Remove all links from the selected emails">Unlink</button>
        <button class="btn tiny ghost" onclick="OL.clearEmailSelection()">✕ Clear</button>`;
    if (window.lucide) lucide.createIcons();
};

async function afterBulk() {
    OL.clearEmailSelection();
    if (typeof OL.loadGmailFeed === 'function') await OL.loadGmailFeed();
    OL._dashboardEmailsCache = null;
    OL._refreshAfterGmailAction?.();
    OL.scheduleViewRefresh?.(0);
}

OL.bulkEmailAction = async function(action) {
    const sel = Object.entries(OL.bulkEmailSelection);
    if (!sel.length) return;
    if (action === 'delete' && !confirm(`Delete ${sel.length} conversation${sel.length === 1 ? '' : 's'}? They'll be moved to Trash in Gmail too. Emails with links or notes are archived instead of removed.`)) return;

    const ids = sel.map(([id]) => id);
    const threads = [...new Set(sel.map(([, v]) => v.threadId).filter(Boolean))];
    const headers = { 'Content-Type': 'application/json', ...(await OL.getAuthHeaders()) };

    if (action === 'archive' || action === 'unarchive') {
        const archived = action === 'archive';
        await db.from('gmail_messages').update({ archived }).in('id', ids);
        if (threads.length) await db.from('gmail_messages').update({ archived }).in('thread_id', threads);
        const fn = archived ? 'archive-gmail-message' : 'unarchive-gmail-message';
        await Promise.all(sel.map(([id, v]) => fetch(`${SUPA}/${fn}`, { method: 'POST', headers, body: JSON.stringify({ id, threadId: v.threadId || undefined }) })
            .then(r => OL.handleGmailActionResponse?.(r, archived ? 'Archived' : 'Restored')).catch(() => {})));
    }

    if (action === 'delete') {
        await Promise.all(sel.map(([id, v]) => fetch(`${SUPA}/delete-gmail-message`, { method: 'POST', headers, body: JSON.stringify({ id, threadId: v.threadId || undefined }) })
            .then(r => OL.handleGmailActionResponse?.(r, 'Deleted')).catch(() => {})));
        let rows = [];
        const q1 = await db.from('gmail_messages').select('id, linked_client_id, linked_task_id, linked_resource_id, linked_request_id, linked_event_id, note').in('id', ids);
        rows = q1.data || [];
        if (threads.length) {
            const q2 = await db.from('gmail_messages').select('id, linked_client_id, linked_task_id, linked_resource_id, linked_request_id, linked_event_id, note').in('thread_id', threads);
            (q2.data || []).forEach(r => { if (!rows.some(x => x.id === r.id)) rows.push(r); });
        }
        const keep = rows.filter(r => r.linked_client_id || r.linked_task_id || r.linked_resource_id || r.linked_request_id || r.linked_event_id || r.note).map(r => r.id);
        const drop = rows.map(r => r.id).filter(id => !keep.includes(id));
        if (keep.length) await db.from('gmail_messages').update({ archived: true }).in('id', keep);
        if (drop.length) await db.from('gmail_messages').delete().in('id', drop);
    }
    await afterBulk();
};

OL.bulkEmailLink = async function() {
    const st = OL._bulkEmailLink || {};
    const ids = Object.keys(OL.bulkEmailSelection);
    if (!st.clientId || !ids.length) return;
    const client = state.clients[st.clientId];
    const task = st.taskId ? (client?.projectData?.clientTasks || []).find(t => String(t.id) === String(st.taskId)) : null;
    const resource = task && OL._findResourceForTask ? OL._findResourceForTask(st.clientId, task) : null;
    const payload = {
        linked_client_id: st.clientId,
        linked_task_id: st.taskId || null,
        linked_request_id: st.requestId || task?.requestLineItemId || null,
        link_locked: true
    };
    if (resource) payload.linked_resource_id = resource.id;
    const { error } = await db.from('gmail_messages').update(payload).in('id', ids);
    if (error) { alert('Could not link: ' + error.message); return; }
    OL._bulkEmailLink = { clientId: '', taskId: '', requestId: '' };
    await afterBulk();
};

OL.bulkEmailUnlink = async function() {
    const ids = Object.keys(OL.bulkEmailSelection);
    if (!ids.length || !confirm(`Remove all links from ${ids.length} email${ids.length === 1 ? '' : 's'}?`)) return;
    const { error } = await db.from('gmail_messages').update({ linked_client_id: null, linked_task_id: null, linked_resource_id: null, linked_request_id: null, linked_event_id: null, link_locked: true }).in('id', ids);
    if (error) { alert('Could not unlink: ' + error.message); return; }
    await afterBulk();
};

// Keep the bar in sync after any page redraw.
window.addEventListener('hashchange', () => setTimeout(() => OL.renderBulkEmailToolbar(), 0));
