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
import { requestIdsForTask } from '../core/task-links.js';

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
    // A task belongs to a request through its links (a task can be linked to several), or the older single field.
    tasks.forEach((t) => {
        const ids = new Set([...(requestIdsForTask(t) || []).map(String), ...(t.requestLineItemId ? [String(t.requestLineItemId)] : [])]);
        if (requestIds.some((r) => ids.has(String(r)))) rootTaskIds.push(String(t.id));
    });
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

// Excerpts and attachments pulled out of emails and linked to this item, a request under it, or a task under it
// (gmail_messages.piece_links). Returns [{ messageId, subject, sender, date, link }], newest first.
export async function loadRollupPieces(clientId, kind, id) {
    const { taskIds, requestIds } = rollupScope(clientId, kind, id);
    const wanted = new Map();          // targetId -> targetType
    if (kind === 'request' || kind === 'resource' || kind === 'task') wanted.set(String(id), kind);
    requestIds.forEach((r) => wanted.set(String(r), 'request'));
    taskIds.forEach((t) => wanted.set(String(t), 'task'));
    if (!wanted.size) return [];
    const ors = [...wanted.keys()].map((tid) => `piece_links.cs.${JSON.stringify([{ targetId: tid }])}`);
    const { data, error } = await db.from('gmail_messages')
        .select('id, sender, subject, date, piece_links')
        .or(ors.join(','))
        .order('date', { ascending: false })
        .limit(200);
    let rows = data;
    if (error) {
        // The filter above depends on how the database matches inside the links; if it is refused, fall back to
        // this project's emails and pick the links out here.
        console.warn('Rollup excerpt filter failed, falling back:', error.message);
        const fb = await db.from('gmail_messages').select('id, sender, subject, date, piece_links').eq('linked_client_id', clientId).order('date', { ascending: false }).limit(500);
        if (fb.error) { console.error('Rollup excerpt load failed:', fb.error.message); return []; }
        rows = fb.data;
    }
    const out = [];
    (rows || []).forEach((m) => {
        (Array.isArray(m.piece_links) ? m.piece_links : []).forEach((l) => {
            if (l && wanted.has(String(l.targetId))) out.push({ messageId: m.id, subject: m.subject, sender: m.sender, date: m.date, link: l });
        });
    });
    return out;
}

// One block listing everything linked from email: whole emails, then excerpts and attachments. Shared by the
// request window, the request detail drawer, and the rolled-up sections.
export async function renderEmailLinksInto(container, clientId, kind, id) {
    if (!container) return;
    container.innerHTML = '<span class="tiny muted">Loading…</span>';
    const [emails, pieces] = await Promise.all([loadRollupEmails(clientId, kind, id), loadRollupPieces(clientId, kind, id)]);
    const wholeIds = new Set(emails.map((m) => String(m.id)));
    const whole = emails.map((m) => `
        <div style="padding:6px 8px; background:rgba(168,85,247,0.04); border:1px solid var(--line); border-radius:4px; cursor:pointer;" onclick="OL.openGmailMessageModal('${esc(m.id)}')">
            <div style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="mail" style="width:11px;height:11px;color:#a855f7;flex-shrink:0;"></i>
                <strong class="tiny" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.subject || 'No Subject')}</strong>
                <span class="tiny muted" style="flex-shrink:0;">${m.date ? esc(new Date(m.date).toLocaleDateString()) : ''}</span>
                <span class="pill tiny soft" style="font-size:9px;">whole email</span>
            </div>
            ${(m.note || m.snippet) ? `<div class="tiny muted" style="margin-top:4px; max-height:60px; overflow:hidden; white-space:pre-wrap;">${esc(m.note || m.snippet)}</div>` : ''}
        </div>`);
    const bits = pieces.map((p) => {
        const l = p.link, isAtt = l.kind === 'attachment';
        const body = isAtt ? (l.attachmentName || l.text || 'Attachment') : (l.text || '');
        return `
        <div style="padding:6px 8px; background:rgba(56,189,248,0.04); border:1px solid var(--line); border-radius:4px; cursor:pointer;" onclick="OL.openGmailMessageModal('${esc(p.messageId)}')">
            <div style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="${isAtt ? 'paperclip' : 'quote'}" style="width:11px;height:11px;color:#38bdf8;flex-shrink:0;"></i>
                <strong class="tiny" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(p.subject || 'No Subject')}</strong>
                <span class="tiny muted" style="flex-shrink:0;">${p.date ? esc(new Date(p.date).toLocaleDateString()) : ''}</span>
                <span class="pill tiny soft" style="font-size:9px;">${isAtt ? 'attachment' : 'excerpt'}${l.targetType && String(l.targetId) !== String(id) ? ` on ${esc(l.targetType)}` : ''}</span>
            </div>
            <div class="tiny" style="margin-top:4px; max-height:72px; overflow:hidden; white-space:pre-wrap;">${esc(body)}</div>
            ${l.note ? `<div class="tiny muted" style="margin-top:2px;">${esc(l.note)}</div>` : ''}
        </div>`;
    });
    container.innerHTML = (whole.length || bits.length)
        ? `<div style="display:grid; gap:4px;">${whole.join('')}${bits.join('')}</div>`
        : '<span class="tiny muted">None.</span>';
    if (window.lucide) lucide.createIcons();
}

// A self-contained section for the request window: fills itself in once it is on the page.
export function requestEmailsSectionHtml(clientId, requestId) {
    return `
    <div style="margin-bottom:16px;">
        <label class="tiny muted" style="font-size:10px; font-weight:600;">Emails linked to this request</label>
        <div id="request-email-links-${esc(String(requestId))}" style="margin-top:4px;"><span class="tiny muted">Loading…</span></div>
    </div>`;
}
export function hydrateRequestEmailsSection(clientId, requestId) {
    const box = document.getElementById(`request-email-links-${requestId}`);
    if (box) renderEmailLinksInto(box, clientId, 'request', requestId);
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

        <div class="tiny muted uppercase bold" style="margin-bottom:4px;">Linked emails, excerpts and attachments</div>
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
    await renderEmailLinksInto(box, clientId, kind, id);
}

Object.assign(window.OL, { collectRollup, renderRollupSection, hydrateRollupSection, loadRollupEmails, loadRollupPieces, renderEmailLinksInto, requestEmailsSectionHtml, hydrateRequestEmailsSection, rollupScope });
