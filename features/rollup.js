//======================= FEATURES / ROLLUP =======================//
// Everything rolls up to the highest parent, view-only:
//   subtask -> task -> request -> the request's resource(s)
// A request shows the comments, Drive uploads and linked emails of every
// task under it (and their subtasks). A resource shows the same for every
// task that points at it directly and every request that covers it.
// Nothing is copied into the parent's own data — it's read live from the
// children, so edits and deletions on a task show up everywhere at once,
// and the parent's own comments/files stay separate from the rolled-up ones.

import { state, esc, db } from '../core/data.js';
import { requestResourceIds } from '../core/request-pricing.js';

function pd(clientId) { return state.clients?.[clientId]?.projectData || {}; }

// The task ids under a set of root tasks, following parentTaskId down.
function withSubtasks(clientId, rootIds) {
    const tasks = pd(clientId).clientTasks || [];
    const out = new Set(rootIds.map(String));
    let grew = true;
    while (grew) {
        grew = false;
        tasks.forEach((t) => {
            if (t.parentTaskId && out.has(String(t.parentTaskId)) && !out.has(String(t.id))) { out.add(String(t.id)); grew = true; }
        });
    }
    return out;
}

function requestsCoveringResource(clientId, resId) {
    const reqs = OL.listProjectRequests ? OL.listProjectRequests(state.clients[clientId]) : [];
    return reqs.filter((r) => requestResourceIds(r).includes(String(resId)));
}

// kind: 'task' | 'request' | 'resource'. Returns the ids of every
// descendant task (not including a task root itself) plus request ids.
export function rollupScope(clientId, kind, id) {
    const tasks = pd(clientId).clientTasks || [];
    let requestIds = [];
    let rootTaskIds = [];
    if (kind === 'task') {
        const all = withSubtasks(clientId, [id]);
        all.delete(String(id));
        return { taskIds: [...all], requestIds: [] };
    }
    if (kind === 'request') requestIds = [String(id)];
    if (kind === 'resource') {
        const res = (pd(clientId).localResources || []).find((r) => String(r.id) === String(id));
        requestIds = requestsCoveringResource(clientId, id).map((r) => String(r.id));
        rootTaskIds = tasks.filter((t) => String(t.parentResourceId || '') === String(id)
            || (res?.name && (t.resourceName || '').trim().toLowerCase() === res.name.trim().toLowerCase())).map((t) => String(t.id));
    }
    tasks.forEach((t) => { if (t.requestLineItemId && requestIds.includes(String(t.requestLineItemId))) rootTaskIds.push(String(t.id)); });
    return { taskIds: [...withSubtasks(clientId, rootTaskIds)], requestIds };
}

function taskById(clientId, id) { return (pd(clientId).clientTasks || []).find((t) => String(t.id) === String(id)); }

export function collectRollup(clientId, kind, id) {
    const { taskIds, requestIds } = rollupScope(clientId, kind, id);
    const comments = [];
    const files = [];
    taskIds.forEach((tid) => {
        const t = taskById(clientId, tid);
        if (!t) return;
        const from = { taskId: t.id, taskTitle: t.title || t.name || 'Task' };
        (t.comments || []).forEach((c) => comments.push({ ...c, ...from }));
        (t.clickupComments || []).forEach((c) => comments.push({ ...c, ...from, _clickup: true }));
        const tf = t.driveFiles || (t.driveFileUrl ? [{ name: t.driveFileName || 'Attached Drive File', url: t.driveFileUrl }] : []);
        tf.forEach((f) => files.push({ ...f, ...from }));
    });
    // A resource also rolls up the requests' own uploads/comments.
    if (kind === 'resource') {
        requestIds.forEach((rid) => {
            const item = OL.findRequestItem ? OL.findRequestItem(state.clients[clientId], rid) : null;
            if (!item) return;
            const from = { requestId: item.id, taskTitle: 'Request: ' + (OL.requestItemTitle ? OL.requestItemTitle(state.clients[clientId], item) : 'Request') };
            (item.comments || []).forEach((c) => comments.push({ ...c, ...from }));
            (item.driveFiles || []).forEach((f) => files.push({ ...f, ...from }));
        });
    }
    comments.sort((a, b) => new Date(b.date || b.timestamp || 0) - new Date(a.date || a.timestamp || 0));
    return { taskIds, requestIds, comments, files };
}

// Emails linked to the item itself or to anything under it.
export async function loadRollupEmails(clientId, kind, id) {
    const { taskIds, requestIds } = rollupScope(clientId, kind, id);
    const ors = [];
    if (kind === 'request') ors.push(`linked_request_id.eq.${id}`);
    if (kind === 'resource') ors.push(`linked_resource_id.eq.${id}`);
    if (kind === 'task') ors.push(`linked_task_id.eq.${id}`);
    requestIds.filter((r) => String(r) !== String(id)).forEach((r) => ors.push(`linked_request_id.eq.${r}`));
    if (taskIds.length) ors.push(`linked_task_id.in.(${taskIds.map((t) => `"${String(t).replace(/"/g, '')}"`).join(',')})`);
    if (!ors.length) return [];
    const cols = 'id, sender, subject, snippet, date, note, note_html, linked_task_id, linked_request_id, linked_resource_id';
    let { data, error } = await db.from('gmail_messages').select(cols).or(ors.join(',')).order('date', { ascending: false }).limit(200);
    if (error && /note_html|linked_request_id/.test(error.message || '')) {
        ({ data, error } = await db.from('gmail_messages').select('id, sender, subject, snippet, date, note, linked_task_id, linked_resource_id').or(ors.filter((o) => !o.startsWith('linked_request_id')).join(',') || 'id.eq.__none__').order('date', { ascending: false }).limit(200));
    }
    if (error) { console.error('Rollup email load failed:', error.message); return []; }
    return data || [];
}

const fromPill = (clientId, r) => r.taskId
    ? `<span class="pill tiny soft" style="font-size:9px; cursor:pointer; flex-shrink:0;" onclick="event.stopPropagation(); OL.openTaskInContext('${esc(clientId)}', '${esc(String(r.taskId))}')" title="Open the task this came from">↳ ${esc(r.taskTitle)}</span>`
    : `<span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">↳ ${esc(r.taskTitle || '')}</span>`;

// Placeholder section; call hydrateRollupSection() after it's in the DOM.
export function renderRollupSection(clientId, kind, id) {
    const { taskIds, comments, files } = collectRollup(clientId, kind, id);
    if (!taskIds.length && kind !== 'request' && kind !== 'resource') return '';
    const label = kind === 'task' ? 'subtasks' : 'linked tasks';
    return `
    <div id="rollup-${kind}-${esc(String(id))}" style="margin-bottom:20px; padding:14px; border:1px dashed rgba(100,198,162,0.4); border-radius:6px; background:rgba(100,198,162,0.03);">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
            <i data-lucide="layers" style="width:12px;height:12px;color:#64c6a2;"></i>
            <label class="bold tiny uppercase muted" style="margin:0;">Rolled up from ${label}</label>
            <span class="pill tiny soft" style="font-size:9px;">${taskIds.length} task${taskIds.length === 1 ? '' : 's'} · view only</span>
        </div>

        <div class="tiny muted uppercase bold" style="margin-bottom:4px;">Uploads (${files.length})</div>
        <div style="display:grid; gap:4px; margin-bottom:10px;">
            ${files.length ? files.map((f) => `
                <div style="display:flex; align-items:center; gap:6px; padding:5px 8px; background:rgba(0,0,0,0.12); border-radius:4px;">
                    <i data-lucide="file-text" style="width:12px;height:12px;color:var(--accent);flex-shrink:0;"></i>
                    <a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer" class="tiny bold" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:inherit;">${esc(f.name || 'File')}</a>
                    ${fromPill(clientId, f)}
                </div>`).join('') : '<span class="tiny muted">None.</span>'}
        </div>

        <div class="tiny muted uppercase bold" style="margin-bottom:4px;">Linked emails</div>
        <div class="rollup-emails" style="display:grid; gap:4px; margin-bottom:10px;"><span class="tiny muted">Loading…</span></div>

        <div class="tiny muted uppercase bold" style="margin-bottom:4px;">Comments (${comments.length})</div>
        <div style="display:grid; gap:4px; max-height:320px; overflow:auto;">
            ${comments.length ? comments.map((c) => `
                <div style="padding:6px 8px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:4px;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">
                        <strong class="tiny">${esc(c.author || 'Someone')}</strong>
                        <span class="tiny muted">${c.date || c.timestamp ? esc(new Date(c.date || c.timestamp).toLocaleDateString([], { dateStyle: 'medium' })) : ''}</span>
                        <span style="margin-left:auto;">${fromPill(clientId, c)}</span>
                    </div>
                    <div class="tiny" style="line-height:1.45; overflow-wrap:anywhere;">${OL.renderCommentTextWithMentions ? OL.renderCommentTextWithMentions(c.text, c.html) : esc(c.text || '')}</div>
                </div>`).join('') : '<span class="tiny muted">None.</span>'}
        </div>
    </div>`;
}

export async function hydrateRollupSection(clientId, kind, id) {
    const box = document.querySelector(`#rollup-${kind}-${CSS.escape(String(id))} .rollup-emails`);
    if (!box) return;
    const emails = await loadRollupEmails(clientId, kind, id);
    const titleFor = (m) => {
        if (m.linked_task_id) { const t = taskById(clientId, m.linked_task_id); if (t) return { taskId: t.id, taskTitle: t.title || t.name }; }
        return { taskTitle: kind === 'request' ? 'this request' : kind === 'resource' ? 'this resource' : 'this task' };
    };
    box.innerHTML = emails.length ? emails.map((m) => {
        const src = titleFor(m);
        const note = m.note_html ? OL.sanitizeCommentHtml(m.note_html) : esc(m.note || m.snippet || '');
        return `
        <div style="padding:6px 8px; background:rgba(168,85,247,0.04); border:1px solid var(--line); border-radius:4px; cursor:pointer;" onclick="OL.openGmailMessageModal('${esc(m.id)}')">
            <div style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="mail" style="width:11px;height:11px;color:#a855f7;flex-shrink:0;"></i>
                <strong class="tiny" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.subject || 'No Subject')}</strong>
                <span class="tiny muted" style="flex-shrink:0;">${m.date ? esc(new Date(m.date).toLocaleDateString()) : ''}</span>
                ${fromPill(clientId, src)}
            </div>
            ${note ? `<div class="tiny muted ol-richtext-view" style="margin-top:4px; max-height:90px; overflow:hidden; ${m.note_html ? '' : 'white-space:pre-wrap;'}">${note}</div>` : ''}
        </div>`;
    }).join('') : '<span class="tiny muted">None.</span>';
    if (window.lucide) lucide.createIcons();
}

Object.assign(window.OL, { collectRollup, renderRollupSection, hydrateRollupSection, loadRollupEmails, rollupScope });
