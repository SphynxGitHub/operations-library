//======================= CORE / NOTE SEARCH =======================//
// Finds the notes (capture_notes) that best answer a question, with no AI: words in common, with a small boost for
// matching words in a row and for recent notes. The AI only reads the top few to write an answer, and every note it
// cites must be one it was given. Pure functions.

import { tokens } from './recap-items.js';

export function rankNotes(question, notes, { limit = 12, today = new Date().toISOString().slice(0, 10) } = {}) {
    const q = tokens(question);
    if (!q.length) return [];
    const phrase = String(question || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return (notes || []).map((n) => {
        const body = String(n.body || '');
        const set = new Set(tokens(body));
        const hits = q.filter((w) => set.has(w)).length;
        if (!hits) return null;
        let score = hits / q.length;
        if (phrase.length > 6 && body.toLowerCase().replace(/\s+/g, ' ').includes(phrase)) score += 0.5;
        const ageDays = n.created_at ? Math.max(0, (Date.parse(today) - Date.parse(String(n.created_at).slice(0, 10))) / 86400000) : 365;
        score += Math.max(0, 0.1 - ageDays / 3650);
        return { note: n, score: Math.round(score * 1000) / 1000 };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);
}

// A short piece of the note around the first matching word.
export function snippet(body, question, width = 220) {
    const text = String(body || '').replace(/\s+/g, ' ').trim();
    const w = tokens(question).find((x) => text.toLowerCase().includes(x));
    const at = w ? Math.max(0, text.toLowerCase().indexOf(w) - 60) : 0;
    return (at > 0 ? '…' : '') + text.slice(at, at + width) + (at + width < text.length ? '…' : '');
}

// The AI answer: keep only citations that are real notes it was given.
export function checkAnswer(ai, givenNotes) {
    const ids = new Set((givenNotes || []).map((n) => String(n.id)));
    const cites = (Array.isArray(ai?.citations) ? ai.citations : []).map(String).filter((c) => ids.has(c));
    const answer = String(ai?.answer || '').trim().slice(0, 3000);
    if (!answer || !cites.length) return { answer: answer && !cites.length ? '' : answer, citations: [], found: false };
    return { answer, citations: [...new Set(cites)], found: !!ai.found };
}
