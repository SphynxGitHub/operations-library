//======================= CORE / SUGGESTED ASKS =======================//
// What we are likely to need from the client, shown as a list to untick or edit. Nothing is created or sent without
// approval. The learning loop uses the suggestion log: asks that are almost always removed are dropped, and asks people
// keep adding by hand become suggestions.

export function normalizeAsks(ai, max = 25) {
    const list = Array.isArray(ai?.asks) ? ai.asks : Array.isArray(ai) ? ai : [];
    const seen = new Set();
    return list.slice(0, max).map((a) => ({
        label: String(a?.label || a?.title || '').trim().slice(0, 160),
        why: String(a?.why || '').trim().slice(0, 300),
        resource: String(a?.resource || '').trim().slice(0, 120),
        stage: ['before_scoping', 'after_scoping', 'before_work'].includes(a?.stage) ? a.stage : 'before_scoping',
        fromMissingLater: !!a?.fromMissingLater,
    })).filter((a) => a.label && !seen.has(a.label.toLowerCase()) && seen.add(a.label.toLowerCase()));
}

// Remove asks already asked (same words) so the second run only lists what is still missing.
export function withoutAlreadyAsked(asks, askedLabels) {
    const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
    const asked = (askedLabels || []).map(words);
    return (asks || []).filter((a) => { const w = words(a.label); return !asked.some((x) => w.size && [...w].filter((k) => x.has(k)).length / w.size >= 0.5); });
}

// log: [{ label, status: accepted|edited|dismissed|manual }] for past suggested asks.
// Returns { drop: Set(labelLower), add: [labels] }.
export function learnFromLog(log, { minSeen = 4, dropAtRemovedRate = 0.85, addAtManualCount = 2 } = {}) {
    const stats = {};
    (log || []).forEach((r) => {
        const k = String(r?.label || '').trim().toLowerCase(); if (!k) return;
        const s = (stats[k] = stats[k] || { label: r.label, kept: 0, removed: 0, manual: 0 });
        if (r.status === 'dismissed') s.removed++; else if (r.status === 'manual') s.manual++; else if (r.status === 'accepted' || r.status === 'edited') s.kept++;
    });
    const drop = new Set(), add = [];
    Object.entries(stats).forEach(([k, s]) => {
        const shown = s.kept + s.removed;
        if (shown >= minSeen && s.removed / shown >= dropAtRemovedRate) drop.add(k);
        if (s.manual >= addAtManualCount) add.push(s.label);
    });
    return { drop, add };
}
export function applyLearning(asks, learned) {
    const kept = (asks || []).filter((a) => !learned.drop.has(a.label.toLowerCase()));
    const have = new Set(kept.map((a) => a.label.toLowerCase()));
    learned.add.forEach((label) => { if (!have.has(label.toLowerCase())) kept.push({ label, why: 'People often add this by hand', resource: '', stage: 'before_scoping', fromMissingLater: false }); });
    return kept;
}

// Plain-language email listing the accepted asks, for the Communications person to send.
export function asksEmailDraft(asks, { clientFirstName = '', senderName = '' } = {}) {
    const lines = (asks || []).map((a) => `- ${a.label}`).join('\n');
    return { subject: 'A few things we need to get started', body: `Hi${clientFirstName ? ' ' + clientFirstName : ''},\n\nTo keep things moving, could you send us the following when you get a chance?\n\n${lines}\n\nIf anything is unclear, just reply and we will walk through it.\n\n${senderName ? 'Best,\n' + senderName : 'Best,'}` };
}
