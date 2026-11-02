//======================= FEATURES / RESOURCE KEY CHANGES =======================//
// A third tab on a resource, beside Comments and Edit History:
//   Key changes          the notes someone pinned to this resource (the default view)
//   All related notes    every comment on the tasks linked to this resource, read live, so nothing needs searching for
// Any comment in "All related notes" can be pinned in one click, and a pinned note can be unpinned.
//
// A pinned note is a row in capture_notes (core/captures.js) with this resource's id. Task comments still live on their
// tasks, so pinning stores the comment's text with a link back to it (source_kind task_comment, source_id the comment).

import { state, esc, getActiveClient, getCurrentUserName } from '../core/data.js';
import { linksForTask } from '../core/task-links.js';
import { saveNote, notesFor, deleteNote } from '../core/captures.js';

let mode = 'key';          // 'key' | 'all'

function linkedTasks(client, resourceId) {
    const rid = String(resourceId);
    return (client?.projectData?.clientTasks || []).filter((t) => t && (String(t.parentResourceId || '') === rid
        || linksForTask(t).some((l) => (l.resourceIds || []).map(String).includes(rid))));
}

const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const strip = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function paint(resourceId) {
    const host = document.getElementById('resource-key-host');
    if (!host || host.dataset.res !== String(resourceId)) return;
    const client = getActiveClient();
    const pinned = await notesFor({ resourceId });
    const pinnedSources = new Set(pinned.filter((n) => n.source_kind === 'task_comment').map((n) => String(n.source_id)));

    let body = '';
    if (mode === 'key') {
        body = pinned.length ? pinned.map((n) => `
            <div style="padding:10px 0;border-bottom:1px solid var(--line);">
                <div style="font-size:13px;line-height:1.5;overflow-wrap:anywhere;">${esc(n.body)}</div>
                <div style="display:flex;gap:8px;align-items:center;margin-top:4px;"><span class="tiny muted">${esc(n.author || '')}${n.author ? ' · ' : ''}${esc(when(n.created_at))}</span>
                    <button class="btn tiny soft" style="margin-left:auto;" onclick="OL.resourceKeyUnpin('${esc(String(resourceId))}','${esc(n.id)}')">Unpin</button></div>
            </div>`).join('')
            : '<div class="tiny muted" style="padding:20px 0;text-align:center;">Nothing pinned yet. Switch to All related notes and pin what matters.</div>';
    } else {
        const rows = [];
        linkedTasks(client, resourceId).forEach((t) => {
            (t.comments || []).filter((c) => c && !c.system && strip(c.text || c.html)).forEach((c) => rows.push({ t, c }));
        });
        rows.sort((a, b) => new Date(b.c.date || 0) - new Date(a.c.date || 0));
        body = rows.length ? rows.map(({ t, c }) => `
            <div style="padding:10px 0;border-bottom:1px solid var(--line);">
                <div class="tiny muted" style="margin-bottom:2px;">${esc(t.title || t.name || 'Task')}</div>
                <div style="font-size:13px;line-height:1.5;overflow-wrap:anywhere;">${esc(strip(c.text || c.html))}</div>
                <div style="display:flex;gap:8px;align-items:center;margin-top:4px;"><span class="tiny muted">${esc(c.author || '')}${c.author ? ' · ' : ''}${esc(when(c.date))}</span>
                    ${pinnedSources.has(String(c.id)) ? '<span class="pill tiny soft" style="margin-left:auto;cursor:default;">Pinned</span>'
                        : `<button class="btn tiny soft" style="margin-left:auto;" onclick="OL.resourceKeyPin('${esc(String(resourceId))}','${esc(String(t.id))}','${esc(String(c.id))}')">Pin to this resource</button>`}</div>
            </div>`).join('')
            : '<div class="tiny muted" style="padding:20px 0;text-align:center;">No comments on the tasks linked to this resource.</div>';
    }
    const tab = (k, label) => `<span onclick="OL.resourceKeyMode('${k}','${esc(String(resourceId))}')" style="padding:3px 10px;cursor:pointer;${mode === k ? 'background:rgba(45,212,191,.14);color:#2dd4bf;font-weight:600;' : ''}">${label}</span>`;
    host.innerHTML = `<div style="display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:12px;margin-bottom:8px;">${tab('key', 'Key changes')}${tab('all', 'All related notes')}</div>${body}`;
}

export function resourceKeyChangesHtml(res) {
    setTimeout(() => paint(res.id), 0);
    return `<div id="resource-key-host" data-res="${esc(String(res.id))}" style="min-width:0;"><div class="tiny muted">Loading...</div></div>`;
}

export function resourceKeyMode(m, resourceId) { mode = m === 'all' ? 'all' : 'key'; paint(resourceId); }

export async function resourceKeyPin(resourceId, taskId, commentId) {
    const client = getActiveClient();
    const task = (client?.projectData?.clientTasks || []).find((t) => String(t.id) === String(taskId));
    const c = (task?.comments || []).find((x) => String(x.id) === String(commentId));
    if (!client || !c) return;
    await saveNote({ clientId: client.id, taskId, resourceId, author: c.author || getCurrentUserName(), type: 'note', visibility: 'team',
                     body: strip(c.text || c.html), sourceKind: 'task_comment', sourceId: c.id });
    paint(resourceId);
}

export async function resourceKeyUnpin(resourceId, noteId) { await deleteNote(noteId); paint(resourceId); }

window.OL = window.OL || {};
Object.assign(window.OL, { resourceKeyChangesHtml, resourceKeyMode, resourceKeyPin, resourceKeyUnpin });
