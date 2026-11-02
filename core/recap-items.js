//======================= CORE / RECAP ITEMS =======================//
// Meeting side of the AI work, with no AI in it. (1) Splits the "Recap Items" section of a Zoom summary into entries.
// (2) Checks each Zoom action item against the client's tasks so it is not created twice.
//
// The section the Zoom prompt adds (one entry per line, nothing else in the section):
//   Recap Items
//   - Change: The confirmation email should use the new logo. [Confirmation Email]
//   - Request: They want a text reminder the day before. [Reminders]
//   - Approval: Round 2 looks good to start. [Round 2]
//   - Question: Can the form collect a second phone number?
//   - Info: Their office is closed the week of the 14th.
// Type is Change, Request, Approval, Question or Info. The bracket at the end is the thing it is about, when named.

export const RECAP_TYPES = { change: 'change', request: 'new_request', approval: 'approval', question: 'note', info: 'note' };

const HEAD = /^\s*(?:#{1,6}\s*|\*\*)?\s*recap\s+items\s*(?:\*\*)?\s*:?\s*$/i;
const ZOOM_HEAD = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(quick recap|next steps|summary|action items|overview)\s*(?:\*\*)?\s*:?\s*$/i;
const OTHER_HEAD = /^\s*(?:#{1,6}\s+\S|\*\*[^*]+\*\*\s*:?\s*$|[A-Z][A-Za-z ]{2,40}:\s*$)/;

export function parseRecapItems(summaryText) {
    const lines = String(summaryText || '').replace(/\r/g, '').split('\n');
    const start = lines.findIndex((l) => HEAD.test(l));
    if (start < 0) return [];
    const items = [];
    for (let i = start + 1; i < lines.length; i++) {
        const raw = lines[i];
        if (!raw.trim()) { if (items.length) { const next = lines.slice(i + 1).find((l) => l.trim()); if (!next || !/^\s*[-*•\d]/.test(next)) break; } continue; }
        const isBullet = /^\s*(?:[-*•]|\d+[.)])\s/.test(raw);
        // Zoom's own headings are plain lines ("Next Steps", "Summary"); any short unpunctuated non-bullet line after entries also ends the section.
        if (!isBullet && (ZOOM_HEAD.test(raw) || (items.length && raw.trim().length <= 40 && !/[.!?:]$/.test(raw.trim())))) break;
        if (OTHER_HEAD.test(raw) && !isBullet) break;
        const body = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
        if (!body) continue;
        const m = /^(change|request|approval|question|info(?:rmation)?)\s*[:\-–—]\s*(.+)$/i.exec(body);
        const word = m ? m[1].toLowerCase().replace('information', 'info') : 'info';
        let text = m ? m[2].trim() : body;
        let target = '';
        const t = /\[([^\]]{1,120})\]\s*\.?\s*$/.exec(text);
        if (t) { target = t[1].trim(); text = text.slice(0, t.index).trim(); }
        if (text && !/^(none|n\/a|nothing|no items)\.?$/i.test(text)) items.push({ type: RECAP_TYPES[word] || 'note', word, text, targetHint: target });
    }
    return items;
}

// ---- duplicate check ---------------------------------------------------------------------------------------------
const STOP = new Set('a an and are as at be but by can do for from get has have i in is it its me my of on or our so that the their them then there they this to us was we will with you your would should could please need needs want wants also just about into out up'.split(' '));
export function tokens(text) {
    return [...new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .map((w) => w.replace(/(ing|ed|es|s)$/, '')).filter((w) => w.length > 2 && !STOP.has(w)))];
}
// Share of the smaller text's words found in the other: a short task title inside a long action item still matches.
export function similarity(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.length || !B.length) return 0;
    const setB = new Set(B);
    const common = A.filter((w) => setB.has(w)).length;
    return common / Math.min(A.length, B.length);
}

export const STRONG = 0.7, POSSIBLE = 0.45, RECENT_DAYS = 30;

// item: text. tasks: { id, title, instructions?, closed: bool, closedAt? }. Only open tasks can be matched; a similar
// task closed within RECENT_DAYS is shown as context ("recently completed") and the item is still treated as new work.
export function duplicateCheck(itemText, tasks, today = new Date().toISOString().slice(0, 10)) {
    let best = null, recent = null;
    (tasks || []).forEach((t) => {
        if (!t) return;
        const score = Math.max(similarity(itemText, t.title), similarity(itemText, `${t.title} ${t.instructions || ''}`) * 0.9);
        if (t.closed) {
            const ageDays = t.closedAt ? Math.round((Date.parse(today) - Date.parse(String(t.closedAt).slice(0, 10))) / 86400000) : Infinity;
            if (score >= POSSIBLE && ageDays <= RECENT_DAYS && (!recent || score > recent.score)) recent = { taskId: t.id, title: t.title, score };
        } else if (score >= POSSIBLE && (!best || score > best.score)) best = { taskId: t.id, title: t.title, score };
    });
    const level = best ? (best.score >= STRONG ? 'strong' : 'possible') : 'none';
    return { level, match: best, recentlyCompleted: recent,
             // strong = collapsed, defaults to "link to existing"; one click flips it. Anything else defaults to "create new".
             defaultAction: level === 'strong' ? 'link_existing' : 'create_new' };
}

export function checkActionItems(items, tasks, today) {
    return (items || []).map((text) => ({ text, ...duplicateCheck(text, tasks, today) }));
}
