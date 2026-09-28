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
import { rollDownPieceLinks, removePieceLink } from '../core/roll-down.js';

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
        const all = Array.isArray(m.piece_links) ? m.piece_links : [];
        all.forEach((l) => {
            if (!l || !wanted.has(String(l.targetId))) return;
            // A copy rolled down from a link that is itself in this list isn't shown a second time.
            if (l.rolledDownFrom && all.some((o) => o && o.id === l.rolledDownFrom && wanted.has(String(o.targetId)))) return;
            out.push({ messageId: m.id, subject: m.subject, sender: m.sender, date: m.date, link: l });
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
    const removeBtn = (onclick, title) => `<button type="button" class="btn tiny soft" style="color:#ef4444; flex-shrink:0; padding:0 6px;" title="${esc(title)}" onclick="event.stopPropagation(); ${onclick}">✕</button>`;
    const whole = emails.map((m) => `
        <div style="padding:6px 8px; background:rgba(168,85,247,0.04); border:1px solid var(--line); border-radius:4px; cursor:pointer;" onclick="OL.openGmailMessageModal('${esc(m.id)}')">
            <div style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="mail" style="width:11px;height:11px;color:#a855f7;flex-shrink:0;"></i>
                <strong class="tiny" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.subject || 'No Subject')}</strong>
                <span class="tiny muted" style="flex-shrink:0;">${m.date ? esc(new Date(m.date).toLocaleDateString()) : ''}</span>
                <span class="pill tiny soft" style="font-size:9px;">whole email</span>
                ${kind === 'request' && String(m.linked_request_id || '') === String(id) ? removeBtn(`OL.removeEmailRequestLink('${esc(m.id)}','${esc(clientId)}','${esc(id)}')`, 'Unlink this email from the request') : ''}
            </div>
            ${(m.note || m.snippet) ? `<div class="tiny muted" style="margin-top:4px; max-height:60px; overflow:hidden; white-space:pre-wrap;">${esc(m.note || m.snippet)}</div>` : ''}
        </div>`);
    const bits = pieces.filter((p) => !(p.link.kind === 'email' && wholeIds.has(String(p.messageId)))).map((p) => {
        const l = p.link, isAtt = l.kind === 'attachment', isWhole = l.kind === 'email';
        const body = isAtt ? (l.attachmentName || l.text || 'Attachment') : (l.text || '');
        return `
        <div style="padding:6px 8px; background:rgba(56,189,248,0.04); border:1px solid var(--line); border-radius:4px; cursor:pointer;" onclick="OL.openGmailMessageModal('${esc(p.messageId)}')">
            <div style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="${isAtt ? 'paperclip' : 'quote'}" style="width:11px;height:11px;color:#38bdf8;flex-shrink:0;"></i>
                <strong class="tiny" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(p.subject || 'No Subject')}</strong>
                <span class="tiny muted" style="flex-shrink:0;">${p.date ? esc(new Date(p.date).toLocaleDateString()) : ''}</span>
                <span class="pill tiny soft" style="font-size:9px;">${isAtt ? 'attachment' : isWhole ? 'whole email' : 'excerpt'}${l.targetType && String(l.targetId) !== String(id) ? ` on ${esc(l.targetType)}` : ''}${l.rolledDownFrom ? ' · from request' : ''}</span>
                ${removeBtn(`OL.removeEmailPiece('${esc(p.messageId)}','${esc(l.id)}','${esc(clientId)}','${esc(kind)}','${esc(id)}')`, l.rolledDownFrom ? 'Remove this from the task' : 'Remove this link (also removes the copies on its build tasks)')}
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

// Removing links after the fact, from wherever they're listed. Removing an excerpt or attachment also removes the
// copies that were rolled down from it onto build tasks.
export async function removeEmailPiece(messageId, linkId, clientId, kind, id) {
    if (!confirm('Remove this link? The email itself is not deleted.')) return;
    const { data: m, error } = await db.from('gmail_messages').select('piece_links').eq('id', messageId).single();
    if (error) { alert('Could not remove it. Please try again.'); return; }
    const next = removePieceLink(m.piece_links, linkId);
    const { error: upErr } = await db.from('gmail_messages').update({ piece_links: next }).eq('id', messageId);
    if (upErr) { alert('Could not remove it. Please try again.'); return; }
    refreshEmailLinks(clientId, kind, id);
}
export async function removeEmailRequestLink(messageId, clientId, requestId) {
    if (!confirm('Unlink this email from the request? The email itself is not deleted.')) return;
    // The copies of this email that were rolled down onto build tasks go with it.
    const { data: m } = await db.from('gmail_messages').select('piece_links').eq('id', messageId).single();
    const kept = (Array.isArray(m?.piece_links) ? m.piece_links : []).filter((l) => l && l.rolledDownFrom !== `email:${messageId}`);
    const { error } = await db.from('gmail_messages').update({ linked_request_id: null, piece_links: kept }).eq('id', messageId).eq('linked_request_id', requestId);
    if (error) { alert('Could not unlink it. Please try again.'); return; }
    refreshEmailLinks(clientId, 'request', requestId);
}
function refreshEmailLinks(clientId, kind, id) {
    const box = document.getElementById(`request-email-links-${id}`) || document.querySelector(`#rollup-${kind}-${CSS.escape(String(id))} .rollup-emails`) || document.getElementById('linked-request-emails-list');
    if (box) renderEmailLinksInto(box, clientId, kind, id);
}

// At activation: everything already linked to the request from email (excerpts, attachments, the whole email)
// is copied onto the request's new build tasks, so it's right there where the work happens. tasks: [{ id, title }].
export async function rollDownRequestLinks(clientId, requestId, tasks) {
    if (!tasks || !tasks.length) return 0;
    const { data, error } = await db.from('gmail_messages')
        .select('id, subject, piece_links, linked_request_id')
        .or(`linked_request_id.eq.${requestId},piece_links.cs.${JSON.stringify([{ targetId: String(requestId) }])}`)
        .limit(500);
    if (error) { console.warn('Roll-down lookup failed:', error.message); return 0; }
    let total = 0;
    for (const m of (data || [])) {
        const r = rollDownPieceLinks(m.piece_links, m, requestId, tasks, { uid: () => 'pl-' + Math.random().toString(36).slice(2, 10), now: new Date().toISOString() });
        if (!r.added) continue;
        const { error: upErr } = await db.from('gmail_messages').update({ piece_links: r.pieceLinks }).eq('id', m.id);
        if (upErr) console.warn('Roll-down save failed:', upErr.message); else total += r.added;
    }
    return total;
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

Object.assign(window.OL, { collectRollup, renderRollupSection, hydrateRollupSection, loadRollupEmails, loadRollupPieces, renderEmailLinksInto, removeEmailPiece, removeEmailRequestLink, rollDownRequestLinks, requestEmailsSectionHtml, hydrateRequestEmailsSection, rollupScope });

// ---------------------------------------------------------------------------------------------
// OPEN CLIENT TASKS — a compact nested list, reused everywhere an implementation task's or the
// consolidated follow-up's open client asks need to show up: the Tasks tab, a task's own detail
// sidebar, and the client-context sidebars on an email, a compose window and a meeting summary.
// ---------------------------------------------------------------------------------------------

// items: [{ id, title, status, askKind, dueDate }] (client tasks). indent: left margin in px.
export function renderOpenClientTasksList(clientId, items, { indent = 28, label = 'Client is being asked for' } = {}) {
    if (!items || !items.length) return '';
    return `
        <div style="margin: 2px 0 6px ${indent}px; padding:6px 10px; border-left:2px dashed rgba(245,158,11,0.5); background:rgba(245,158,11,0.04); border-radius:0 6px 6px 0;">
            <div class="tiny muted" style="margin-bottom:3px;">${esc(label)}:</div>
            ${items.map((t) => `
                <div class="tiny" style="display:flex; align-items:center; gap:6px; padding:2px 0; cursor:pointer;" onclick="event.stopPropagation(); OL.openTaskInContext('${esc(clientId)}', '${esc(t.id)}')">
                    <i data-lucide="mail" style="width:10px;height:10px; color:#f59e0b; flex-shrink:0;"></i>
                    <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(t.title || t.name || 'Task')}</span>
                    <span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">${esc(t.status || '')}</span>
                    ${t.dueDate ? `<span class="tiny muted" style="flex-shrink:0;">${esc(String(t.dueDate).slice(0, 10))}</span>` : ''}
                </div>
            `).join('')}
        </div>`;
}

// The subset of a client's currently open client-ask tasks worth surfacing in a general "here's what's
// outstanding for this client" sidebar (email, compose window, meeting summary) — not scoped to one task.
export function openClientTasksForClient(clientId, { limit = 8 } = {}) {
    const client = state.clients?.[clientId];
    const tasks = client?.projectData?.clientTasks || [];
    const closed = (typeof OL.getSystemStatuses === 'function' ? OL.getSystemStatuses() : []).filter((s) => s.isClosed).map((s) => s.name);
    const isOpen = (t) => !closed.includes(t.status) && t.status !== 'Done';
    return tasks.filter((t) => t && !t.consolidatedFollowUp && (t.askKind || t.isClientTask) && t.askKind !== 'follow_up' && isOpen(t))
        .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))
        .slice(0, limit);
}

// A self-contained "Open with this client" sidebar block — for the email suggestions panel, the compose
// window, and the meeting summary window, all of which have a client in context but no single task to scope to.
export function clientOpenItemsSidebarHtml(clientId) {
    if (!clientId) return '';
    const items = openClientTasksForClient(clientId);
    if (!items.length) return '';
    return `
        <div style="margin-bottom:14px;">
            <div class="tiny bold uppercase muted" style="margin-bottom:6px;">Open with this client (${items.length})</div>
            <div style="display:grid; gap:4px;">
                ${items.map((t) => `
                    <div class="tiny" style="display:flex; align-items:center; gap:6px; padding:5px 8px; border:1px solid var(--line); border-radius:5px; cursor:pointer;" onclick="OL.openTaskInContext('${esc(clientId)}', '${esc(t.id)}')">
                        <i data-lucide="mail" style="width:11px;height:11px; color:#f59e0b; flex-shrink:0;"></i>
                        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(t.title || t.name || 'Task')}</span>
                        <span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">${esc(t.status || '')}</span>
                    </div>
                `).join('')}
            </div>
        </div>`;
}

Object.assign(window.OL, { renderOpenClientTasksList, openClientTasksForClient, clientOpenItemsSidebarHtml });
