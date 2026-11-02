//======================= CORE / GRADUATION =======================//
// A suggestion type may link by itself only after it has earned it: enough decided suggestions, a very high share accepted
// unchanged in the high-confidence band, and a person approves. Auto-links are logged and can be undone. Pure functions
// over suggestion_log rows ({ suggestion_type, confidence, status }).

export const GRAD_MIN_DECIDED = 30;       // decided suggestions in the high-confidence band
export const GRAD_MIN_RATE = 95;          // % accepted unchanged
export const GRAD_TYPES = ['change', 'new_request', 'note', 'approval'];   // types that can link to an existing item

export function gradStats(rows, type) {
    const high = (rows || []).filter((r) => r && r.suggestion_type === type && r.confidence === 'high' && r.status && r.status !== 'pending' && r.status !== 'manual');
    const unchanged = high.filter((r) => r.status === 'accepted').length;
    return { type, decided: high.length, unchanged, rate: high.length ? Math.round((unchanged / high.length) * 100) : null };
}
export function eligibility(rows, type, { minDecided = GRAD_MIN_DECIDED, minRate = GRAD_MIN_RATE } = {}) {
    const s = gradStats(rows, type);
    const ok = s.decided >= minDecided && s.rate !== null && s.rate >= minRate;
    return { ...s, eligible: ok, needs: ok ? '' : s.decided < minDecided ? `${minDecided - s.decided} more decided suggestions` : `acceptance of ${minRate}% (now ${s.rate}%)` };
}
// Approval lives in the org settings: ai_graduated = { type: { by, at } }
export const isGraduated = (settings, type) => !!(settings?.aiGraduated && settings.aiGraduated[type]);
// Only an approved type, a high-confidence suggestion, with a real target, may link by itself.
export const mayAutoLink = (settings, s) => isGraduated(settings, s.type) && s.confidence === 'high' && !!s.target;
