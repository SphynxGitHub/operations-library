//======================= CORE / STATUS MOVES =======================//
// Moving something backward (a resource back to In Process, a closed task reopened) asks three things:
//   what changed, why, and, when "we caused it", a pattern tag. The answers are kept so they can show up in the
// resource history and so repeat causes can be spotted and prevented.
//
// WHY_CATEGORIES decide treatment: "we caused it" is rework (not billed, not allowance), "they are asking for more"
// draws on the tweak allowance or needs an estimate, "the world changed" is its own bucket.

import { db, uid } from './data.js';

export const WHY_CATEGORIES = [
    { key: 'we_caused_it',    label: 'We caused it',            hint: 'A mistake or a missed step on our side. Not billed and not taken from the tweak allowance.' },
    { key: 'asking_for_more', label: 'They are asking for more', hint: 'A new wish or a bigger scope. Draws on the tweak allowance, or needs an estimate first.' },
    { key: 'world_changed',   label: 'The world changed',        hint: 'A tool, a rule or a person changed outside our control.' },
];

export const PATTERN_TAGS = [
    'Missed an edge case', 'Did not test a path', 'Misread the request', 'Wrong or missing access',
    'Changed something else by accident', 'Sample data did not match real data', 'Handoff gap', 'Other',
];

// Prefill from the email or recap that triggered the move (the suggestion card has all of these):
//   { what, whyCategory, askedBy, sourceNoteId, quote, date }
// Anything the prefill does not know stays blank for the person to fill in.
export function buildMovePrefill(s = {}) {
    return {
        what: s.what || '',
        whyCategory: WHY_CATEGORIES.some((c) => c.key === s.whyCategory) ? s.whyCategory : '',
        patternTag: '',
        askedBy: s.askedBy || '',
        quote: s.quote || '',
        date: s.date || '',
        sourceNoteId: s.sourceNoteId || null,
        fromSource: !!(s.what || s.quote || s.askedBy),
    };
}

// Returns a list of problems; empty means it can be saved.
export function validateMove(m = {}) {
    const problems = [];
    if (!String(m.what || '').trim()) problems.push('Say what is changing.');
    if (!WHY_CATEGORIES.some((c) => c.key === m.whyCategory)) problems.push('Choose why it is moving back.');
    if (m.whyCategory === 'we_caused_it' && !String(m.patternTag || '').trim()) problems.push('Choose the pattern behind it.');
    return problems;
}

let tableOk = true;
const off = (e) => { if (tableOk) console.warn('Move history is switched off for this session:', e?.message || e); tableOk = false; };

export async function saveMove({ clientId, itemType, itemId, fromStatus, toStatus, what, whyCategory, patternTag, askedBy, sourceNoteId, movedBy } = {}) {
    if (!tableOk || !clientId || !itemId) return null;
    const row = {
        id: 'mv_' + uid().slice(3), client_id: String(clientId), item_type: itemType || 'resource', item_id: String(itemId),
        from_status: fromStatus || null, to_status: toStatus || null, what: String(what || '').trim() || null,
        why_category: whyCategory || null, pattern_tag: whyCategory === 'we_caused_it' ? (patternTag || null) : null,
        asked_by: askedBy || null, source_note_id: sourceNoteId || null, moved_by: movedBy || null,
    };
    try {
        const { error } = await db.from('status_moves').insert(row);
        if (error) { off(error); return null; }
        return row;
    } catch (e) { off(e); return null; }
}
