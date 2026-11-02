//======================= CORE / CAPTURES =======================//
// One shape for a note, stored once (table capture_notes) and referenced from the task, request or resource it
// belongs to. Nothing is copied: a note shown on a task and on its resource is the same row.
//
// Pure builders plus thin database calls. The database calls never throw into the app: if the table is missing
// or blocked they log once and return empty, so a note can never stop someone saving their work.

import { db, uid } from './data.js';
import { scrubSecrets } from './secret-scrub.js';

export const NOTE_TYPES = ['note', 'email', 'meeting', 'system'];
export const NOTE_VISIBILITY = ['team', 'admin', 'client'];

export function buildNote({ clientId, taskId, requestId, resourceId, author, type, visibility, body, sourceKind, sourceId, sourceUrl, now } = {}) {
    const clean = scrubSecrets(body);
    return {
        id: 'note_' + uid().slice(3),
        client_id: String(clientId || ''),
        task_id: taskId ? String(taskId) : null,
        request_id: requestId ? String(requestId) : null,
        resource_id: resourceId ? String(resourceId) : null,
        author: author || null,
        type: NOTE_TYPES.includes(type) ? type : 'note',
        visibility: NOTE_VISIBILITY.includes(visibility) ? visibility : 'team',
        body: clean.text.trim(),
        source_kind: sourceKind || null,
        source_id: sourceId ? String(sourceId) : null,
        source_url: sourceUrl || null,
        created_at: now || new Date().toISOString(),
        edited_at: null,
        secretsRemoved: clean.removed,           // not a column: returned so the caller can show the flag
    };
}

let tableOk = true;
const off = (e) => { if (tableOk) console.warn('Notes are switched off for this session:', e?.message || e); tableOk = false; };

export async function saveNote(fields) {
    const note = buildNote(fields);
    if (!note.client_id || !note.body || !tableOk) return { note: null, secretsRemoved: note.secretsRemoved };
    const { secretsRemoved, ...row } = note;
    try {
        const { error } = await db.from('capture_notes').insert(row);
        if (error) { off(error); return { note: null, secretsRemoved }; }
        return { note: row, secretsRemoved };
    } catch (e) { off(e); return { note: null, secretsRemoved }; }
}

// target: { taskId } | { requestId } | { resourceId } | { clientId }
export async function notesFor(target = {}, limit = 100) {
    if (!tableOk) return [];
    try {
        let q = db.from('capture_notes').select('*').order('created_at', { ascending: false }).limit(limit);
        if (target.taskId) q = q.eq('task_id', String(target.taskId));
        else if (target.requestId) q = q.eq('request_id', String(target.requestId));
        else if (target.resourceId) q = q.eq('resource_id', String(target.resourceId));
        else if (target.clientId) q = q.eq('client_id', String(target.clientId));
        else return [];
        const { data, error } = await q;
        if (error) { off(error); return []; }
        return data || [];
    } catch (e) { off(e); return []; }
}

// Has this email or meeting already been saved as a note on this target? Used so "Add as note" is not done twice.
export async function noteExistsForSource(sourceKind, sourceId, target = {}) {
    if (!tableOk || !sourceKind || !sourceId) return false;
    try {
        let q = db.from('capture_notes').select('id').eq('source_kind', sourceKind).eq('source_id', String(sourceId)).limit(1);
        if (target.taskId) q = q.eq('task_id', String(target.taskId));
        if (target.requestId) q = q.eq('request_id', String(target.requestId));
        if (target.resourceId) q = q.eq('resource_id', String(target.resourceId));
        const { data, error } = await q;
        if (error) { off(error); return false; }
        return (data || []).length > 0;
    } catch (e) { off(e); return false; }
}
