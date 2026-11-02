//======================= CORE / SUGGESTION LOG =======================//
// Every suggestion the system makes (from an email or a meeting recap) is logged with what a person did with it:
// accepted, edited, dismissed, or "manual" for something a person added that the system missed. The log is what
// measures accuracy and later supplies examples. Never throws into the app.

import { db, uid } from './data.js';

export const SUGGESTION_TYPES = ['change', 'approval', 'holding_reply', 'item_received', 'new_request', 'note'];
export const SUGGESTION_OUTCOMES = ['pending', 'accepted', 'edited', 'dismissed', 'manual'];

let tableOk = true;
const off = (e) => { if (tableOk) console.warn('The suggestion log is switched off for this session:', e?.message || e); tableOk = false; };

// s: { clientId, sourceKind, sourceId, type, quote, targetKind, targetId, confidence, secretsRemoved }
export async function logSuggestion(s = {}) {
    if (!tableOk || !s.sourceKind || !s.type) return null;
    const row = {
        id: 'sl_' + uid().slice(3),
        client_id: s.clientId ? String(s.clientId) : null,
        source_kind: s.sourceKind,
        source_id: s.sourceId ? String(s.sourceId) : null,
        suggestion_type: s.type,
        quote: s.quote ? String(s.quote).slice(0, 2000) : null,
        target_kind: s.targetKind || null,
        target_id: s.targetId ? String(s.targetId) : null,
        confidence: ['low', 'medium', 'high'].includes(s.confidence) ? s.confidence : null,
        status: 'pending',
        secrets_removed: Number(s.secretsRemoved) || 0,
    };
    try {
        const { error } = await db.from('suggestion_log').insert(row);
        if (error) { off(error); return null; }
        return row.id;
    } catch (e) { off(e); return null; }
}

// outcome: accepted | edited | dismissed | manual.  editedTo: what it was changed to, when edited.
export async function recordOutcome(logId, outcome, { decidedBy, editedTo } = {}) {
    if (!tableOk || !logId || !SUGGESTION_OUTCOMES.includes(outcome)) return false;
    try {
        const { error } = await db.from('suggestion_log').update({
            status: outcome, decided_by: decidedBy || null, decided_at: new Date().toISOString(),
            edited_to: editedTo && typeof editedTo === 'object' ? editedTo : null,
        }).eq('id', logId);
        if (error) { off(error); return false; }
        return true;
    } catch (e) { off(e); return false; }
}

// Something a person added that the system did not suggest.
export const logManual = (s) => logSuggestion(s).then((id) => (id ? recordOutcome(id, 'manual', { decidedBy: s.decidedBy }) : false));

// { total, accepted, edited, dismissed, manual, acceptRate } for one suggestion type, to see what is ready to trust.
export async function accuracyFor(type, sinceIso) {
    if (!tableOk) return null;
    try {
        let q = db.from('suggestion_log').select('status').eq('suggestion_type', type).neq('status', 'pending');
        if (sinceIso) q = q.gte('created_at', sinceIso);
        const { data, error } = await q;
        if (error) { off(error); return null; }
        const count = (st) => (data || []).filter((r) => r.status === st).length;
        const total = (data || []).length;
        const accepted = count('accepted'), edited = count('edited');
        return { total, accepted, edited, dismissed: count('dismissed'), manual: count('manual'),
                 acceptRate: total ? Math.round(((accepted + edited) / total) * 100) : null };
    } catch (e) { off(e); return null; }
}
