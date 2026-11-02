//======================= CORE / AI COMPARE =======================//
// Shadow-mode report: what the AI would have suggested on emails compared with what a person actually flagged.
// runs: ai_runs rows (feature email) with output.suggestions[{quote}] and source_id = the email id.
// messages: gmail_messages rows with suggestions[{text,status}] and piece_links[{kind,text}] (what people linked).
// covered = the person's flags the AI also found; missed = the person's flags it did not; extra = AI suggestions with no
// matching person flag (possible false flags). Words in common decide a match (core/recap-items.js similarity).

import { similarity } from './recap-items.js';

const MATCH = 0.6;
export function shadowCoverage(runs, messages) {
    const byId = new Map((messages || []).map((m) => [String(m.id), m]));
    let covered = 0, missed = 0, extra = 0, emails = 0;
    (runs || []).forEach((r) => {
        const m = byId.get(String(r.source_id));
        if (!m) return;
        const ai = (r.output?.suggestions || []).map((s) => String(s.quote || ''));
        const flagged = [
            ...(m.suggestions || []).filter((s) => s && (s.status === 'linked')).map((s) => String(s.text || '')),
            ...(m.piece_links || []).filter((p) => p && p.kind === 'excerpt').map((p) => String(p.text || '')),
        ].filter(Boolean);
        if (!flagged.length && !ai.length) return;
        emails++;
        flagged.forEach((f) => { if (ai.some((a) => similarity(a, f) >= MATCH)) covered++; else missed++; });
        ai.forEach((a) => { if (!flagged.some((f) => similarity(a, f) >= MATCH)) extra++; });
    });
    const total = covered + missed;
    return { emails, covered, missed, extra, coverage: total ? Math.round((covered / total) * 100) : null };
}
